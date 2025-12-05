// backend/models/Notification.js 程式碼

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
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
        enum: ['announcement', 'system'] // 訊息類型
    },
    targetRole: {
        type: String,
        // 修正: 加上 'admin' 和 'all'
        enum: ['student', 'store', 'admin', 'all'], 
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// 注意：我將 Model 名稱保留為 'Notification'，與檔案名一致，以避免潛在錯誤。
module.exports = mongoose.model('Notification', notificationSchema);