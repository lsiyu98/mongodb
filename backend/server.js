// 導入所需的模組
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const cors = require('cors');

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

        // 檢查該 ID 是否已連線 (模擬單點登入)
        if (connectedUsers[id] && connectedUsers[id] !== socket.id) {
            // 可選：踢掉舊連線
            // io.to(connectedUsers[id]).emit('auth_error', { message: '您的帳號已在其他地方登入' });
            // io.sockets.sockets.get(connectedUsers[id])?.disconnect(true);
            console.log(`用戶 ${id} 已重新連線。`);
        }
        
        // 儲存連線資訊
        connectedUsers[id] = socket.id;
        socketIdToUser[socket.id] = { id, role };

        // 讓用戶加入自己的 ID 房間 (用於點對點訊息)
        socket.join(id);
        // 讓用戶加入角色房間 (用於廣播，例如所有 'student' 房間)
        // 關鍵：role 房間名稱必須與前端廣播目標一致 (student, store, admin)
        socket.join(role); 

        console.log(`用戶 ${id} (${role}) 已註冊並加入房間: ${id}, ${role}`);
    });

    // 2. 處理點對點聊天訊息
    socket.on('send_chat_message', async (data) => {
        const { senderId, receiverId, message, timestamp } = data;

        // --- 1. 儲存到 MongoDB ---
        try {
            await ChatMessage.create({
                senderId,
                receiverId,
                message,
                timestamp
            });
        } catch (err) {
            console.error("❌ MongoDB 儲存聊天訊息失敗:", err);
        }

        // --- 2. 傳給接收者 ---
        const receiverSocketId = connectedUsers[receiverId];

        if (receiverSocketId) {
            io.to(receiverId).emit('receive_chat_message', data);
            console.log(`Chat: ${senderId} -> ${receiverId}`);
        } else {
            io.to(senderId).emit('receive_chat_message', { 
                senderId: 'System', 
                message: `用戶 ${receiverId} 離線，訊息已送出但可能無法即時收到。`,
                timestamp: new Date().getTime(),
                isSystem: true
            });
        }
    });


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

app.get("/api/chat/:userA/:userB", async (req, res) => {
    const { userA, userB } = req.params;

    const history = await ChatMessage.find({
        $or: [
            { senderId: userA, receiverId: userB },
            { senderId: userB, receiverId: userA }
        ]
    }).sort({ timestamp: 1 });

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
    const { senderId, senderRole, target, message } = req.body;

    if (senderRole !== 'store' && senderRole !== 'admin') {
        return res.status(403).json({ success: false, message: '權限不足' });
    }

    const announcementData = {
        senderId,
        senderRole,
        target,
        message,
        timestamp: new Date().getTime()
    };

    // --- 儲存到 MongoDB ---
    try {
        await Announcement.create(announcementData);
    } catch (err) {
        console.error("❌ MongoDB 儲存公告失敗:", err);
    }

    // --- 廣播給前端 ---
    if (target === 'all') {
        io.emit('new_announcement', announcementData);
    } else {
        io.to(target).emit('new_announcement', announcementData);
    }

    res.json({ success: true });
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