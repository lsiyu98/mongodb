// 導入所需的模組
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const cors = require('cors');
const mongoose = require('mongoose'); // 1. 引入 Mongoose

// --- MongoDB 連線與模型引入 START ---
// 2. 引入 MongoDB 連線模組 (路徑假設為: MONGODB/Nosql/CAMPUS.js)
const connectDB = require('../Nosql/CAMPUS'); 

// 4. 引入 MongoDB 模型 (路徑假設為: MONGODB/backend/models/...)
const ChatMessage = require('./models/ChatMessage');
const Notification = require('./models/Notification'); 
// --- MongoDB 連線與模型引入 END ---

// --- 設定 ---
const PORT = 3001;
// 設置 CORS 來源為 '*'，允許所有客戶端連線
const FRONTEND_URL = '*'; 

// MySQL 資料庫連接配置 (請根據您的環境修改)
const dbConfig = {
    host: 'localhost',
    user: 'root', 
    password: 'yuntechdb', // <-- ***請替換為您的 MySQL 密碼***
    database: 'CampusFoodDB', 
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

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

// 創建資料庫連線池
let pool;
try {
    pool = mysql.createPool(dbConfig);
    console.log("MySQL 連線池已建立。");
} catch (error) {
    console.error("無法建立 MySQL 連線池:", error);
    process.exit(1);
}

// ===========================================
// Socket.IO 即時通訊邏輯
// ===========================================

io.on('connection', (socket) => {
    console.log(`用戶連線: ${socket.id}`);

    // 1. 用戶註冊和加入專屬房間 (用於點對點訊息和廣播)
    socket.on('register_user', ({ id, role }) => {
        if (!id || !role) {
            console.error(`註冊失敗：ID 或 Role 缺失 for socket ${socket.id}`);
            socket.emit('auth_error', { message: 'ID 或 Role 缺失' });
            return;
        }

        // 儲存連線資訊
        connectedUsers[id] = socket.id;
        socketIdToUser[socket.id] = { id, role };

        // 加入 ID 房間 (點對點) 和 Role 房間 (廣播)
        socket.join(id);
        socket.join(role); 

        console.log(`用戶 ${id} (${role}) 已註冊並加入房間: ${id}, ${role}`);
    });

    // 2. 處理點對點聊天訊息
    socket.on('send_chat_message', async (data) => {
        const { senderId, receiverId, message } = data; 
        const userData = socketIdToUser[socket.id];
        const senderRole = userData ? userData.role : 'unknown';

        // --- 1. 儲存到 MongoDB (使用 ChatMessage 模型) ---
        try {
            await ChatMessage.create({ 
                senderId,
                receiverId,
                senderRole: senderRole, 
                message,
            });
        } catch (err) {
            console.error("❌ MongoDB 儲存聊天訊息失敗:", err);
            // 可以選擇發送錯誤訊息回傳給發送者
        }

        // --- 2. 傳給接收者 ---
        // 直接對 receiverId 房間發送訊息，如果對方連線，就會收到
        io.to(receiverId).emit('receive_chat_message', { 
            ...data, 
            timestamp: new Date().getTime() // 補上 timestamp 讓前端顯示
        });
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
// Express API 邏輯 (RESTful API)
// ===========================================

// API 1: 處理訂單狀態更新 (MySQL & Socket.IO 推播)
app.post('/api/order/status', async (req, res) => {
    // ... (保持您原有的訂單狀態更新邏輯) ...
    const { senderId, senderRole, orderId, newStatus } = req.body;
    let connection;

    try {
        connection = await pool.getConnection();

        // 1. 檢查訂單是否存在並取得 StoreID
        const [rows] = await connection.execute(
            'SELECT UserID, StoreID FROM `Order` WHERE OrderID = ?',
            [orderId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: '找不到該訂單。' });
        }

        const order = rows[0];
        const targetUserId = order.UserID;     // 訂購的學生 ID (目標房間名稱)
        const storeId = `store${order.StoreID}`;   // 根據 CAMPUS.sql 預設商店ID 命名規則
        
        // 嚴格檢查：確保發送者 (senderId) 是該訂單所屬的店家 (StoreID)
        // 假設 senderId 來自店家登入，如 'store101'
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
        console.error('API /api/order/status 錯誤:', error);
        res.status(500).json({ success: false, message: '伺服器內部錯誤。' });
    } finally {
        if (connection) connection.release();
    }
});


// API 2: 處理公告廣播 (MongoDB 儲存 & Socket.IO 廣播)
app.post('/api/broadcast', async (req, res) => {
    const { senderId, senderRole, target, message } = req.body;

    // 簡單的權限檢查 (只有 admin 或 store 可以發佈公告)
    if (!['admin', 'store'].includes(senderRole)) {
        return res.status(403).json({ success: false, message: '只有管理員或店家可以發佈公告。' });
    }
    
    // --- 1. 儲存到 MongoDB (使用 Notification 模型) ---
    try {
        await Notification.create({ 
            sender: senderId, 
            message: message,
            type: 'announcement', 
            targetRole: target, // 'student', 'store', or 'all'
        });
    } catch (err) {
        console.error("❌ MongoDB 儲存公告失敗:", err);
        return res.status(500).json({ success: false, message: '公告儲存失敗。' });
    }

    // --- 2. 透過 Socket.IO 廣播 ---
    const broadcastData = {
        senderId,
        message,
        target,
        timestamp: new Date().getTime(),
        type: 'announcement'
    };

    if (target === 'all') {
        // 發送給所有人 (包含所有連線者)
        io.emit('receive_announcement', broadcastData);
        console.log(`廣播公告給所有人: ${message.substring(0, 10)}...`);
    } else if (['student', 'store'].includes(target)) {
        // 發送給特定的角色房間 (例如：io.to('student'))
        io.to(target).emit('receive_announcement', broadcastData);
        console.log(`廣播公告給角色 [${target}]: ${message.substring(0, 10)}...`);
    }
    
    res.json({ success: true, message: '公告已儲存並推播成功。' });
});


// API 3: 獲取歷史聊天紀錄 (MongoDB 查詢)
app.get("/api/chat/history/:user1Id/:user2Id", async (req, res) => {
    const { user1Id, user2Id } = req.params;

    try {
        // 查詢：訊息的發送者和接收者組合必須是 (user1, user2) 或 (user2, user1)
        const history = await ChatMessage.find({
            $or: [
                { senderId: user1Id, receiverId: user2Id },
                { senderId: user2Id, receiverId: user1 }
            ]
        }).sort({ createdAt: 1 }); // 依時間升序排列

        res.json({ success: true, list: history });
    } catch (error) {
        console.error('API /api/chat/history 錯誤:', error);
        res.status(500).json({ success: false, message: '無法獲取聊天紀錄。' });
    }
});


// API 4: 獲取歷史公告 (MongoDB 查詢)
app.get("/api/announcement/all", async (req, res) => {
    try {
        // 查詢所有公告，並依發布時間降序排列
        const list = await Notification.find({ type: 'announcement' })
                                       .sort({ createdAt: -1 }); 

        res.json({ success: true, list });
    } catch (error) {
        console.error('API /api/announcement/all 錯誤:', error);
        res.status(500).json({ success: false, message: '無法獲取公告列表。' });
    }
});


/// server.js (檔案底部)

// ===========================================
// 啟動伺服器 (確保在 MongoDB 連線完成後執行)
// ===========================================
const startServer = async () => {
    try {
        console.log('正在嘗試連線到 MongoDB...');

        // 關鍵修正點：等待 CAMPUS.js 回傳的 Promise 完成
        await connectDB(); 

        console.log('✅ MongoDB 連線成功...');

        // 連線成功後，才啟動 HTTP 伺服器並保持程序運行
        server.listen(PORT, () => {
            console.log(`✅ 伺服器運行於 http://localhost:${PORT}`);
            console.log(`✅ Socket.IO is listening on http://localhost:${PORT}`);
            console.log(`現在三個角色都可以連線了。`);
        });

    } catch (error) {
        console.error('❌ 伺服器啟動失敗，無法連線到 MongoDB:', error);
        // 如果連線失敗，讓程序退出
        process.exit(1);
    }
};

startServer(); // 執行啟動函式