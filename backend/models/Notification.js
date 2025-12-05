// 檔案名稱: campus-food-system/backend/models/notification.js

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    // 發送公告的用戶 ID (如 admin001, store202)
    sender: {
        type: String,
        required: true,
    },
    message: {
        type: String,
        required: true
    },
    type: {
        type: String,
        required: true,
        enum: ['announcement', 'system'] 
    },
    targetRole: {
        type: String,
        // 🌟 修正: 加上 'admin' 和 'all' 目標 🌟
        enum: ['student', 'store', 'admin', 'all'], 
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Notification', notificationSchema);