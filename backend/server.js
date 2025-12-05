const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const cors = require('cors');

// 🌟 關鍵修正 1: 導入獨立的 MongoDB 連線模組 🌟
// 路徑：從 backend/ 跳回上一層 (..)，進入 nosql/ 資料夾
const connectDB = require('../Nosql/CAMPUS.nosql'); 

// 🌟 關鍵修正 2: 導入 MongoDB Models (Models 在本地 models/ 資料夾內) 🌟
const ChatMessage = require('./models/ChatMessage'); 
const Announcement = require('./models/Notification'); // 檔案名為 notification.js

// --- 設定 ---
const PORT = 3001;
const FRONTEND_URL = '*'; 

// MySQL 資料庫連接配置 (保留不變)
const dbConfig = {
    host: 'localhost',
    user: 'root', 
    password: 'yuntechdb', 
    database: 'CampusFoodDB', 
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// 創建 Express 應用程式和 HTTP 伺服器
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: FRONTEND_URL, methods: ["GET", "POST"] }
});

app.use(cors({ origin: FRONTEND_URL })); 
app.use(express.json()); 

const connectedUsers = {}; 
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

connectDB();



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
        
        if (!senderInfo) return;

        // --- 儲存到 MongoDB ---
        try {
            // 確保這裡使用 ChatMessage Model
            await ChatMessage.create({
                senderId,
                receiverId,
                senderRole: senderInfo.role, 
                message,
                createdAt: new Date().getTime() 
            });
        } catch (err) {
            console.error("❌ MongoDB 儲存聊天訊息失敗:", err);
        }

        io.to(receiverId).emit('receive_chat_message', data);
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
        }).sort({ createdAt: 1 });
        res.json({ success: true, messages: history });
    } catch (error) {
         console.error('獲取聊天記錄失敗:', error);
         res.status(500).json({ success: false, message: '伺服器內部錯誤。' });
    }
});


// API 0.5: 獲取所有公告 (使用 Announcement Model)
app.get("/api/announcement/all", async (req, res) => {
    try {
        // 確保這裡使用 Announcement Model
        const list = await Announcement.find().sort({ createdAt: -1 });
        res.json({ success: true, list });
    } catch (error) {
        console.error('獲取公告失敗:', error);
        res.status(500).json({ success: false, message: '伺服器內部錯誤。' });
    }
});


// API 1: 處理公告廣播 (使用 Announcement Model 儲存)
// API 1: 處理公告廣播 (修正儲存與廣播變數)
app.post('/api/broadcast', async (req, res) => {
    const { senderId, senderRole, target, message } = req.body;

    if (senderRole !== 'store' && senderRole !== 'admin') {
        return res.status(403).json({ success: false, message: '權限不足' });
    }

    // 🌟 修正：定義要儲存和廣播的資料 🌟
    const broadcastData = {
        sender: senderId, 
        message: message,
        type: 'announcement', 
        targetRole: target, 
        // 確保 createdAt 屬性存在，以便 Mongoose 處理
        createdAt: new Date().getTime() 
    };

    // --- 儲存到 MongoDB ---
    try {
        // 確保這裡使用 Announcement Model
        await Announcement.create(broadcastData);
    } catch (err) {
        // 如果儲存失敗，我們應該回覆錯誤並終止
        console.error("❌ MongoDB 儲存公告失敗:", err);
        return res.status(500).json({ success: false, message: '伺服器內部錯誤，儲存公告失敗。' });
    }

    // --- 廣播給前端 ---
    // 🌟 修正：廣播時使用正確的變數名稱 broadcastData 🌟
    if (target === 'all' || target === 'admin' || target === 'student' || target === 'store') {
        io.to(target).emit('new_announcement', broadcastData);
    } else {
        // 如果 target 欄位沒有指定有效房間，則直接向所有連線發送
        io.emit('new_announcement', broadcastData);
    }

    res.json({ success: true, message: '公告已儲存並推播。' });
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
});