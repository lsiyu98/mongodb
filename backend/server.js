// 引入核心套件
const express = require('express');
const cors = require('cors');
const http = require('http'); 
const { Server } = require("socket.io"); 
const mongoose = require('mongoose');
const mysql = require('mysql2/promise'); // 引入 mysql2 的 Promise 版本

// 引入 Mongoose Models
const Notification = require('./models/Notification.js'); 
const ChatMessage = require('./models/ChatMessage.js'); 

const app = express();
const PORT = 3001; 

// --- A. 資料庫連線 ---

// 1. MongoDB 連線設定 (用於即時通訊資料)
const DB_URI = 'mongodb://localhost:27017/campusfooddb'; 

mongoose.connect(DB_URI)
  .then(() => console.log('✅ MongoDB 資料庫連接成功！'))
  .catch(err => console.error('❌ MongoDB 資料庫連接失敗:', err));

// 2. MySQL 連線設定 (用於核心用戶資料)
// !! V.I.P: 請務必修改這裡的資料庫連線參數 !!
const mysqlConfig = {
    host: 'localhost',
    user: 'root', // 您的 MySQL 用戶名
    password: 'yuntechdb', // 您的 MySQL 密碼
    database: 'CampusFoodDB', // 您的美食系統資料庫名稱
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

let mysqlPool;

// 建立 MySQL 連線池
async function connectMySQL() {
    try {
        mysqlPool = mysql.createPool(mysqlConfig);
        await mysqlPool.query('SELECT 1'); // 測試連線
        console.log('✅ MySQL 資料庫連接成功！');
    } catch (error) {
        console.error('❌ MySQL 資料庫連接失敗:', error);
        // 如果 MySQL 連線失敗，不中斷伺服器，但會影響到身份驗證
    }
}
connectMySQL(); // 伺服器啟動時連線 MySQL

// --- B. 伺服器與中介軟體設定 ---
const server = http.createServer(app); 
app.use(express.json()); 
app.use(cors({ origin: '*' })); 

// 設定 Socket.IO 伺服器
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// --- C. 核心功能：MySQL 身份查詢函數 ---

/**
 * 查詢 MySQL 資料庫，驗證用戶 ID 和角色是否存在。
 * @param {string} id - 用戶或店家 ID (例如 user101, store202)
 * @param {string} role - 角色 (student, store, admin)
 * @returns {boolean} - 身份驗證是否通過
 */
async function verifyIdentityInMySQL(id, role) {
    if (!mysqlPool) {
        console.warn("MySQL 連線尚未建立，跳過身份驗證。");
        return true; // 如果 MySQL 壞了，先允許連線，避免系統癱瘓
    }
    
    let tableName;
    let columnName = 'id'; // 假設 ID 欄位名為 'id'

    // 根據角色判斷查詢哪個表格
    if (role === 'student') {
        tableName = 'users'; // 假設學生在 users 表格
    } else if (role === 'store') {
        tableName = 'stores'; // 假設店家在 stores 表格
    } else if (role === 'admin') {
        tableName = 'admins'; // 假設管理員在 admins 表格 (或在 users 表中標記)
    } else {
        return false; // 無效的角色
    }

    // 執行查詢
    try {
        // 為了安全，使用 ? 進行參數化查詢
        const [rows] = await mysqlPool.query(`SELECT ${columnName} FROM ${tableName} WHERE ${columnName} = ? LIMIT 1`, [id]);
        
        return rows.length > 0; // 找到記錄則返回 true
    } catch (error) {
        console.error(`查詢 MySQL 身份失敗 (表: ${tableName}, ID: ${id}):`, error);
        return false;
    }
}


// --- D. API 路由 (管理員/店家發佈公告) ---

app.post('/api/broadcast', async (req, res) => {
    const { senderId, senderRole, target, message } = req.body; 
    
    // 1. 身份驗證：確保只有 admin 或 store 可以發布公告
    if (senderRole !== 'admin' && senderRole !== 'store') {
        return res.status(403).json({ success: false, message: '只有管理員或店家可以發佈公告' });
    }
    
    // 2. 增加：在發佈前確認發送者 ID 在 MySQL 中是合法的
    const isValidSender = await verifyIdentityInMySQL(senderId, senderRole);
    if (!isValidSender) {
        return res.status(403).json({ success: false, message: '發送者身份未在核心資料庫中驗證通過，禁止發佈。' });
    }
    
    // 3. 檢查輸入是否完整
    if (!target || !message) {
        return res.status(400).json({ success: false, message: '目標或訊息不能為空' });
    }
    
    // 發送者名稱/ID
    const senderName = senderId; 

    try {
        // 4. 儲存通知到 MongoDB
        const newNotification = new Notification({
            sender: senderName, 
            message: message,
            type: 'announcement',
            targetRole: target,
        });
        await newNotification.save(); 
        
        // 5. 透過 Socket.IO 推播給所有目標角色
        io.to(target).emit('new_announcement', { 
            sender: senderName, 
            message: message,
            timestamp: newNotification.createdAt
        });

        res.status(200).json({ success: true, message: '公告已發送並記錄' });
    } catch (error) {
        console.error('發送公告失敗:', error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: `資料驗證失敗: ${error.message}` });
        }
        res.status(500).json({ success: false, message: '伺服器錯誤，無法儲存記錄' });
    }
});


// --- E. WebSocket 連線事件處理 (即時聊天) ---
io.on('connection', (socket) => {
    console.log(`[WS] 用戶已連線: ${socket.id}`);
    
    // 處理註冊用戶
    socket.on('register_user', async (userInfo) => {
        const { id, role } = userInfo; 
        
        // 增加：使用 MySQL 驗證用戶身份
        const isValid = await verifyIdentityInMySQL(id, role);

        if (!isValid) {
            console.log(`[WS] 拒絕連線：ID ${id} (角色: ${role}) 未通過 MySQL 身份驗證。`);
            // 斷開連線，通知前端身份無效
            socket.emit('auth_error', { message: '身份驗證失敗，請檢查ID或聯繫管理員。' });
            socket.disconnect(true); // 強制斷線
            return;
        }

        // 身份驗證成功，加入頻道
        socket.join(id); 
        socket.join(role); 
        console.log(`[WS] 用戶 ${id} 已成功註冊推播頻道 (${role} & ${id})`);
    });

    // 處理聊天訊息發送
    socket.on('send_chat_message', async (data) => {
        try {
            // 聊天訊息發送前也檢查一下發送者的身份
            const isValidSender = await verifyIdentityInMySQL(data.senderId, data.senderRole);
            if (!isValidSender) {
                console.warn(`[WS] 拒絕訊息發送：發送者 ID ${data.senderId} 身份無效。`);
                socket.emit('chat_error', { message: '您的身份無效，無法發送訊息。' });
                return;
            }

            const newChatMessage = new ChatMessage(data); 
            await newChatMessage.save(); 
            
            const receiverRoom = data.receiverId; 
            
            io.to(receiverRoom).emit('receive_chat_message', { 
                ...data, 
                timestamp: newChatMessage.createdAt 
            }); 
            
        } catch (error) {
            console.error('儲存或發送聊天訊息失敗:', error);
        }
    });
    
    // 斷線處理
    socket.on('disconnect', () => {
        console.log(`[WS] 用戶已離線: ${socket.id}`);
    });
});


// --- F. 啟動伺服器 ---
server.listen(PORT, () => {
    console.log(`🚀 後端伺服器已啟動，正在監聽 http://localhost:${PORT}`);
});