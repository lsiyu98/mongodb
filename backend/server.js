// 導入所需的模組
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const cors = require('cors');
const mongoose = require('mongoose');

// --- 設定 ---
const PORT = 3001;
// 這是您在 app.html 中設定的 API URL
// **修正: 為了確保客戶端無論是從 file:// 還是其他埠載入都能連線，將 CORS 來源設置為 '*'**
const FRONTEND_URL = '*'; 

// MySQL 資料庫連接配置 (請根據您的環境修改)
const dbConfig = {
    host: 'localhost',
    user: 'root', // 假設您使用 root
    password: 'yuntechdb', // 請替換為您的 MySQL 密碼
    database: 'CampusFoodDB', // 使用您在 CAMPUS.sql 中創建的資料庫名稱
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const MONGODB_URI = 'mongodb://localhost:27017/CampusFoodDB';
// server.js 修正後的 Mongoose 區塊

// ===========================================
// Mongoose / MongoDB 連線與 Model 定義
// ===========================================

// 連線到 MongoDB (位置建議放在所有 Model 定義之前)
mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log("MongoDB 連線成功。");
    })
    .catch(err => {
        console.error("❌ 無法連線到 MongoDB:", err);
    });


// 1. 定義公告 (Announcement) Schema 和 Model (已修正欄位以符合您的要求)
const AnnouncementSchema = new mongoose.Schema({
    // id 會由 Mongoose 自動產生為 _id
    title: { type: String, required: true }, // 新增 title 欄位
    content: { type: String, required: true }, // 對應內容
    type: { type: String, enum: ['system', 'store', 'admin'], default: 'system' }, // 訊息類型
    target_scope: { type: String, required: true, enum: ['all', 'student', 'store', 'admin'] }, // 廣播目標
    publish_date: { type: Date, default: Date.now }, // 發布日期
    created_by: { type: String, required: true }, // 發送者 ID
    // created_at 和 updated_at 由 timestamps: true 自動產生
}, { timestamps: true }); 
const Announcement = mongoose.model('Announcement', AnnouncementSchema);


// 2. 定義聊天訊息 (ChatMessage) Schema 和 Model (使用 timestamps: true 簡化)
const ChatMessageSchema = new mongoose.Schema({
    senderId: { type: String, required: true },
    receiverId: { type: String, required: true },
    message: { type: String, required: true },
    // 移除 timestamp 欄位，改用 Mongoose 自動管理 createdAt
}, { timestamps: true }); // <-- 使用 timestamps: true
const ChatMessage = mongoose.model('ChatMessage', ChatMessageSchema);

// 創建 Express 應用程式和 HTTP 伺服器
const app = express();
const server = http.createServer(app);

// 創建 Socket.IO 伺服器
const io = new Server(server, {
    cors: {
        origin: FRONTEND_URL, // 允許所有來源連線
        methods: ["GET", "POST"]
    }
});

// 設置 Express 中間件
app.use(cors({ origin: FRONTEND_URL })); // 允許所有來源的 API 請求
app.use(express.json()); // 讓 Express 能夠解析 JSON 請求體

// 儲存已連線用戶的資訊 (UserID -> SocketID)
const connectedUsers = {}; 
// 儲存 SocketID -> 用戶資訊 (UserID, Role)
const socketIdToUser = {};

// 創建資料庫連線池
let pool;
try {
    pool = mysql.createPool(dbConfig);
    console.log("MySQL 連線池已建立。");
} catch (error) {
    console.error("無法建立 MySQL 連線池:", error);
    process.exit(1); // 連線失敗則退出應用程式
}

// ===========================================
// Socket.IO 即時通訊邏輯
// ===========================================

io.on('connection', (socket) => {
    console.log(`用戶連線: ${socket.id}`);

    // 1. 用戶註冊和加入專屬房間
    socket.on('register_user', ({ id, role }) => {
        if (!id || !role) {
            console.error(`註冊失敗：ID 或 Role 缺失 for socket ${socket.id}`);
            socket.emit('auth_error', { message: 'ID 或 Role 缺失' });
            return;
        }
        
        // 儲存連線資訊
        connectedUsers[id] = socket.id;
        socketIdToUser[socket.id] = { id, role };

        socket.join(id);
        socket.join(role); 

        console.log(`用戶 ${id} (${role}) 已註冊並加入房間: ${id}, ${role}`);
    });

    // 2. 處理點對點聊天訊息 (修正後的完整區塊)
    socket.on('send_chat_message', async (data) => {
        // 從 data 中解構變數 (這裡假設前端仍然傳遞 timestamp，雖然我們在 Schema 中改用 createdAt)
        const { senderId, receiverId, message } = data; 
        
        // **注意：如果前端沒有傳遞 senderId/receiverId/message，程式碼會崩潰。建議檢查。**
        if (!senderId || !receiverId || !message) {
             console.error('聊天訊息格式錯誤:', data);
             return;
        }

        // --- 1. 儲存到 MongoDB ---
        try {
            await ChatMessage.create({
                senderId,
                receiverId,
                message,
                // 不再儲存 timestamp 欄位，讓 Mongoose 自動產生 createdAt
            });
        } catch (err) {
            console.error("❌ MongoDB 儲存聊天訊息失敗:", err);
        }

        // --- 2. 傳給接收者 (此邏輯必須在 socket.on 內部！) ---
        const receiverSocketId = connectedUsers[receiverId];

        if (receiverSocketId) {
            // 直接將接收到的 data 物件傳送給接收者
            io.to(receiverId).emit('receive_chat_message', data);
            console.log(`Chat: ${senderId} -> ${receiverId}`);
        } else {
            // 用戶離線，傳送系統訊息給發送者
            io.to(senderId).emit('receive_chat_message', { 
                senderId: 'System', 
                message: `用戶 ${receiverId} 離線，訊息已送出但可能無法即時收到。`,
                timestamp: new Date().getTime(),
                isSystem: true
            });
        }
    }); // <--- 修正: 確保函式在這裡正確關閉


    // 3. 用戶斷開連線
    socket.on('disconnect', () => {
        const userData = socketIdToUser[socket.id];
        if (userData) {
            // 從追蹤列表中移除
            delete connectedUsers[userData.id];
            delete socketIdToUser[socket.id];
            console.log(`用戶斷開連線: ${userData.id} (${userData.role})`);
        } else {
            console.log(`未註冊用戶斷開連線: ${socket.id}`);
        }
    });
});

// 修正: 使用 Mongoose 自動產生的 createdAt 欄位進行排序
app.get("/api/chat/:userA/:userB", async (req, res) => {
    const { userA, userB } = req.params;

    const history = await ChatMessage.find({
        $or: [
            { senderId: userA, receiverId: userB },
            { senderId: userB, receiverId: userA }
        ]
    // 修正: 使用 createdAt 排序
    }).sort({ createdAt: 1 }); 

    res.json({ success: true, messages: history });
});

// ===========================================
// Express API 路由
// ===========================================
app.get("/api/announcement/all", async (req, res) => {
    const list = await Announcement.find().sort({ timestamp: -1 });
    res.json({ success: true, list });
});



// API 1: 處理公告廣播
app.post('/api/broadcast', async (req, res) => {
    // 修正: 假設前端現在傳遞 Schema 定義的新欄位名稱
    const { created_by, senderRole, target_scope, title, content } = req.body; 

    // 使用新的變數名稱進行權限檢查
    if (senderRole !== 'store' && senderRole !== 'admin') {
        return res.status(403).json({ success: false, message: '權限不足' });
    }

    const announcementData = {
        title: title || '無標題公告', // 使用 destructured 的 title
        content: content,              // 使用 destructured 的 content
        type: senderRole,              // 這裡使用 senderRole 來代表 type
        target_scope: target_scope,    // 使用 target_scope
        created_by: created_by,        // 使用 created_by
        publish_date: new Date(),
        // 移除 timestamp，依賴 Mongoose 的 timestamps: true
    };

    // ... (後續的 MongoDB 儲存與 Socket.IO 廣播邏輯)
});

// API 2: 處理訂單狀態更新及推播
app.post('/api/order/status', async (req, res) => {
    const { senderId, senderRole, orderId, newStatus } = req.body;

    // 只有 Store 角色可以更新訂單狀態
    if (senderRole !== 'store') {
        return res.status(403).json({ success: false, message: '權限不足，只有店家可以更新訂單狀態。' });
    }

    let connection;
    try {
        connection = await pool.getConnection();

        // 1. 查詢訂單，獲取該訂單的 UserID
        // 假設訂單表名為 'Order'，且其中有 UserID 和 StoreID 欄位
        const [orders] = await connection.execute(
            'SELECT UserID, StoreID FROM `Order` WHERE OrderID = ?',
            [orderId]
        );

        if (orders.length === 0) {
            return res.status(404).json({ success: false, message: `找不到訂單 ID: ${orderId}` });
        }
        
        const order = orders[0];
        const targetUserId = `user${order.UserID}`; // 根據 CAMPUS.sql 預設用戶ID 命名規則
        const storeId = `store${order.StoreID}`;   // 根據 CAMPUS.sql 預設商店ID 命名規則
        
        // 嚴格檢查：確保發送者 (senderId) 是該訂單所屬的店家 (StoreID)
        if (senderId !== storeId) {
             return res.status(403).json({ success: false, message: '您無權更新不屬於您的訂單狀態。' });
        }
        
        // 2. 更新資料庫中的訂單狀態
        await connection.execute(
            'UPDATE `Order` SET Status = ? WHERE OrderID = ?',
            [newStatus, orderId]
        );
        console.log(`DB Update: 訂單 #${orderId} 狀態已更新為 ${newStatus}`);

        // 3. 通過 Socket.IO 推播給相關用戶
        const updateData = {
            orderId: orderId,
            status: newStatus,
            timestamp: new Date().getTime(),
            updater: senderId
        };

        // 推播給訂購的學生 (targetUserId 房間)
        io.to(targetUserId).emit('order_status_update', updateData);
        
        // 推播給管理員 (admin 房間) (可選，用於監控)
        io.to('admin').emit('order_status_update', updateData);

        res.json({ success: true, message: '訂單狀態已更新並推播。' });

    } catch (error) {
        console.error('訂單狀態更新錯誤:', error);
        res.status(500).json({ success: false, message: '伺服器內部錯誤，請檢查資料庫連線。' });
    } finally {
        if (connection) connection.release();
    }
});


// 啟動伺服器
server.listen(PORT, () => {
    console.log(`伺服器運行於 http://localhost:${PORT}`);
    console.log(`請確保您的 MySQL 服務已啟動並使用了 CAMPUS.sql 腳本。`);
    console.log(`現在您可以打開 frontend/app.html 進行測試。`);
});