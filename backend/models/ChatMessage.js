// 檔案名稱: campus-food-system/backend/models/chatmessage.js

const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
    senderId: {
        type: String,
        required: true
    },
    receiverId: {
        type: String,
        required: true
    },
    senderRole: {
        type: String,
        // 🌟 修正: 加上 'admin' 角色 🌟
        enum: ['student', 'store', 'admin'], 
        required: true
    },
    message: {
        type: String,
        required: true
    },
    // 儲存時間戳，用於排序聊天紀錄
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('ChatMessage', chatMessageSchema);