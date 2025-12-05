// server.js 程式碼

// 導入所需的模組
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const cors = require('cors');
// 新增: 導入 Mongoose
const mongoose = require('mongoose'); 

// 新增: 導入 MongoDB Models
const ChatMessage = require('./ChatMessage'); 
const Announcement = require('./Notification'); // 由於您的原始檔名是 Notification.js，這裡保持一致

// --- 設定 ---
const PORT = 3001;
const FRONTEND_URL = '*'; 

// MySQL 資料庫連接配置 (請根據您的環境修改)
const dbConfig = {
    host: 'localhost',
    user: 'root', 
    password: 'yuntechdb', 
    database: 'CampusFoodDB', 
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// MongoDB 連線配置
const MONGODB_URI = 'mongodb://localhost:27017/CampusFoodDB';

// 創建 Express 應用程式和 HTTP 伺服器
const app = express();
const server = http.createServer(app);

// 創建 Socket.IO 伺服器
const io = new Server(server, {
    cors: {
        origin: FRONTEND_URL, 
        methods: ["GET", "POST"]
    }
});

// 設置 Express 中間件
app.use(cors({ origin: FRONTEND_URL })); 
app.use(express.json()); 

// 儲存已連線用戶的資訊 (UserID -> SocketID)
const connectedUsers = {}; 
// 儲存 SocketID -> 用戶資訊 (UserID, Role)
const socketIdToUser = {};

// 創建資料庫連線池 (MySQL)
let pool;
try {
    pool = mysql.createPool(dbConfig);
    console.log("MySQL 連線池已建立。");
} catch (error) {
    console.error("無法建立 MySQL 連線池:", error);
    process.exit(1);
}

// ===========================================
// MongoDB (Mongoose) 連線啟動
// ===========================================

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('✅ MongoDB 連線成功'))
    .catch(err => {
        console.error('❌ MongoDB 連線失敗:', err);
    });

// ===========================================
// Socket.IO 即時通訊邏輯
// ===========================================

io.on('connection', (socket) => {
    console.log(`用戶連線: ${socket.id}`);

    // 1. 用戶註冊和加入專屬房間 (邏輯不變)
    socket.on('register_user', ({ id, role }) => {
        if (!id || !role) {
            console.error(`註冊失敗：ID 或 Role 缺失 for socket ${socket.id}`);
            socket.emit('auth_error', { message: 'ID 或 Role 缺失' });
            return;
        }

        if (connectedUsers[id] && connectedUsers[id] !== socket.id) {
            console.log(`用戶 ${id} 已重新連線。`);
        }
        
        connectedUsers[id] = socket.id;
        socketIdToUser[socket.id] = { id, role };

        socket.join(id);
        socket.join(role); 

        console.log(`用戶 ${id} (${role}) 已註冊並加入房間: ${id}, ${role}`);
    });

    // 2. 處理點對點聊天訊息 (修正為使用 MongoDB)
    socket.on('send_chat_message', async (data) => {
        const { senderId, receiverId, message } = data;
        const senderInfo = socketIdToUser[socket.id];

        if (!senderInfo) {
            console.error('發送聊天訊息失敗：找不到發送者資訊');
            return;
        }

        // --- 1. 儲存到 MongoDB ---
        try {
            await ChatMessage.create({
                senderId,
                receiverId,
                senderRole: senderInfo.role, // 從連線資訊中取得角色
                message,
                createdAt: new Date().getTime()
            });
        } catch (err) {
            console.error("❌ MongoDB 儲存聊天訊息失敗:", err);
        }

        // --- 2. 傳給接收者 ---
        io.to(receiverId).emit('receive_chat_message', data);
        console.log(`Chat: ${senderId} -> ${receiverId}`);

        // 通知發送者對方離線
        if (!connectedUsers[receiverId]) {
            io.to(senderId).emit('receive_chat_message', { 
                senderId: 'System', 
                message: `用戶 ${receiverId} 離線，訊息已送出但可能無法即時收到。`,
                timestamp: new Date().getTime(),
                isSystem: true
            });
        }
    });


    // 3. 用戶斷開連線 (邏輯不變)
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

// API 0: 獲取指定兩用戶的聊天歷史 (使用 MongoDB)
app.get("/api/chat/:userA/:userB", async (req, res) => {
    const { userA, userB } = req.params;

    try {
        const history = await ChatMessage.find({
            $or: [
                { senderId: userA, receiverId: userB },
                { senderId: userB, receiverId: userA }
            ]
        }).sort({ createdAt: 1 }); // 依建立時間升序排列

        res.json({ success: true, messages: history });
    } catch (error) {
         console.error('獲取聊天記錄失敗:', error);
         res.status(500).json({ success: false, message: '伺服器內部錯誤，無法獲取聊天記錄。' });
    }
});

// API 0.5: 獲取所有公告 (使用 MongoDB)
app.get("/api/announcement/all", async (req, res) => {
    try {
        const list = await Announcement.find().sort({ createdAt: -1 });
        res.json({ success: true, list });
    } catch (error) {
        console.error('獲取公告失敗:', error);
        res.status(500).json({ success: false, message: '伺服器內部錯誤，無法獲取公告。' });
    }
});


// API 1: 處理公告廣播 (修正為使用 MongoDB)
app.post('/api/broadcast', async (req, res) => {
    const { senderId, senderRole, target, message } = req.body;

    if (senderRole !== 'store' && senderRole !== 'admin') {
        return res.status(403).json({ success: false, message: '權限不足' });
    }

    const announcementData = {
        sender: senderId,
        message: message,
        type: 'announcement', 
        targetRole: target,
        createdAt: new Date().getTime()
    };

    // --- 儲存到 MongoDB ---
    try {
        await Announcement.create(announcementData);
    } catch (err) {
        console.error("❌ MongoDB 儲存公告失敗:", err);
    }

    // --- 廣播給前端 ---
    if (target === 'all' || target === 'admin' || target === 'student' || target === 'store') {
        io.to(target).emit('new_announcement', announcementData);
    } else {
         // 如果 target 是 'all'，則直接 emit
         io.emit('new_announcement', announcementData);
    }


    res.json({ success: true });
});


// API 2: 處理訂單狀態更新及推播 (使用 MySQL，邏輯不變)
app.post('/api/order/status', async (req, res) => {
    const { senderId, senderRole, orderId, newStatus } = req.body;

    if (senderRole !== 'store') {
        return res.status(403).json({ success: false, message: '權限不足，只有店家可以更新訂單狀態。' });
    }

    let connection;
    try {
        connection = await pool.getConnection();

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
        
        if (senderId !== storeId) {
             return res.status(403).json({ success: false, message: '您無權更新不屬於您的訂單狀態。' });
        }
        
        await connection.execute(
            'UPDATE `Order` SET Status = ? WHERE OrderID = ?',
            [newStatus, orderId]
        );
        console.log(`DB Update: 訂單 #${orderId} 狀態已更新為 ${newStatus}`);

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


// 啟動伺服器
server.listen(PORT, () => {
    console.log(`伺服器運行於 http://localhost:${PORT}`);
    console.log(`請確保您的 MongoDB 和 MySQL 服務皆已啟動。`);
    console.log(`現在您可以打開 frontend/app.html 進行測試。`);
});