// 導入所需的模組
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const cors = require('cors');
const mongoose = require('mongoose');

// ===========================================
// Mongoose / MongoDB 模型 (已整合到 server.js 內)
// ===========================================

// 公告 schema
const NotificationSchema = new mongoose.Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    type: { type: String, default: 'announcement' }, // announcement / order
    target_scope: { type: String, default: 'all' },
    created_by: { type: String, required: true }
}, { timestamps: true });

const Notification = mongoose.model('Notification', NotificationSchema);

// 聊天訊息 schema
const ChatMessageSchema = new mongoose.Schema({
    senderId: { type: String, required: true },
    receiverId: { type: String, required: true },
    message: { type: String, required: true },
}, { timestamps: true });

const ChatMessage = mongoose.model('ChatMessage', ChatMessageSchema);


// --- 設定 ---
const PORT = 3001;
const FRONTEND_URL = '*'; // 允許所有來源連線

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

let pool; // MySQL 連線池將在 startServer 中初始化

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
app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json()); 

// 儲存已連線用戶的資訊
const connectedUsers = {}; 
const socketIdToUser = {};

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

    // 2. 處理點對點聊天訊息
    socket.on('send_chat_message', async (data) => {
        const { senderId, receiverId, message } = data; 
        
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
            // 用戶離線，傳送系統訊息給發送者
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
            delete connectedUsers[userData.id];
            delete socketIdToUser[socket.id];
            console.log(`用戶斷開連線: ${userData.id} (${userData.role})`);
        } else {
            console.log(`未註冊用戶斷開連線: ${socket.id}`);
        }
    });
});

// ===========================================
// Express API 路由
// ===========================================

// API 3: 獲取聊天記錄
app.get("/api/chat/:userA/:userB", async (req, res) => {
    const { userA, userB } = req.params;

    try {
        const history = await ChatMessage.find({
            $or: [
                { senderId: userA, receiverId: userB },
                { senderId: userB, receiverId: userA }
            ]
        }).sort({ createdAt: 1 }); 

        res.json({ success: true, messages: history });
    } catch (error) {
         console.error("查詢聊天記錄失敗:", error);
         res.status(500).json({ success: false, message: '伺服器內部錯誤：查詢聊天記錄失敗。' });
    }
});

// API 4: 獲取所有公告
app.get("/api/announcement/all", async (req, res) => {
    try {
        const list = await Notification.find().sort({ createdAt: -1 }); 
        res.json({ success: true, list });
    } catch (error) {
         console.error("查詢公告失敗:", error);
         res.status(500).json({ success: false, message: '伺服器內部錯誤：查詢公告失敗。' });
    }
});


// API 1: 處理公告廣播
app.post('/api/broadcast', async (req, res) => {
    const { created_by, senderRole, target_scope, title, content } = req.body; 

    if (senderRole !== 'store' && senderRole !== 'admin') {
        return res.status(403).json({ success: false, message: '權限不足' });
    }

    const notificationData = {
        title: title || '公告',
        content: content,
        type: 'announcement',
        target_scope: target_scope || 'all',
        created_by: created_by
    };

    // 1. 儲存到 MongoDB
    let savedNotification;
    try {
        savedNotification = await Notification.create(notificationData); 
        console.log("✅ 公告已成功儲存到 MongoDB。");
    } catch (err) {
        console.error("❌ MongoDB 儲存公告失敗:", err);
        if (err.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: '公告資料驗證失敗。' });
        }
        return res.status(500).json({ success: false, message: '伺服器內部錯誤：MongoDB 儲存失敗。' });
    }

    // 2. 通過 Socket.IO 廣播
    let targetRoom = target_scope || 'all'; 
    
    io.to(targetRoom).emit('new_announcement', {
        sender: created_by,   
        message: content,     
        timestamp: savedNotification.createdAt.getTime(),
        target: targetRoom 
    });

    console.log(`📡 公告已廣播到房間: ${targetRoom}`);
    
    res.json({ success: true, message: `公告已成功發布並廣播到 ${targetRoom}。` });
});

// API 2: 處理訂單狀態更新及推播
app.post('/api/order/status', async (req, res) => {
    // ⚠️ 此 API 依賴 MySQL 連線池 (pool)
    if (!pool) {
         return res.status(503).json({ success: false, message: 'MySQL 連線尚未初始化或已失敗。' });
    }

    const { senderId, senderRole, orderId, newStatus } = req.body;

    if (senderRole !== 'store') {
        return res.status(403).json({ success: false, message: '權限不足，只有店家可以更新訂單狀態。' });
    }

    let connection;
    try {
        connection = await pool.getConnection();

        // 1. 查詢訂單，獲取該訂單的 UserID
        const [orders] = await connection.execute(
            'SELECT UserID, StoreID FROM `Order` WHERE OrderID = ?',
            [orderId]
        );

        if (orders.length === 0) {
            return res.status(404).json({ success: false, message: `找不到訂單 ID: ${orderId}` });
        }
        
        const order = orders[0];
        const targetUserId = `user${order.UserID}`; 
        const storeId = `store${order.StoreID}`;   
        
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

        io.to(targetUserId).emit('order_status_update', updateData);
        io.to('admin').emit('order_status_update', updateData);

        res.json({ success: true, message: '訂單狀態已更新並推播。' });

    } catch (error) {
        console.error('訂單狀態更新錯誤:', error);
        res.status(500).json({ success: false, message: '伺服器內部錯誤，請檢查資料庫連線。' });
    } finally {
        if (connection) connection.release();
    }
});


// ===========================================
// 統一的伺服器啟動邏輯 (使用 async/await)
// ===========================================
async function startServer() {
    // 1. 啟動 MySQL 連線 (等待完成)
    try {
        pool = await mysql.createPool(dbConfig);
        console.log("✅ MySQL 連線池已建立。");
    } catch (error) {
        console.error("❌ 無法建立 MySQL 連線池:", error);
        process.exit(1); 
    }

    // 2. 啟動 MongoDB 連線 (強制等待連線結果)
    try {
        // 【核心修正】: 使用 await 確保連線在啟動前完成
        await mongoose.connect(MONGODB_URI); 
        console.log("✅ MongoDB 連線成功。"); 
    } catch (err) {
        console.error("❌ 無法連線到 MongoDB:", err); 
        console.error("請確認您的 MongoDB 服務 (mongod) 正在運行。");
        process.exit(1); // 連線失敗，強制程序退出
    }

    // 3. 所有連線成功後，啟動 HTTP 伺服器
    server.listen(PORT, () => {
        console.log(`伺服器運行於 http://localhost:${PORT}`);
        console.log(`**請使用 'http-server' 等工具來載入 app.html 進行測試。**`);
    });
}

// 運行啟動函式
startServer();