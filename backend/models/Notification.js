const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    sender: {
        type: String,
        required: true,
        // 修正：移除 enum 限制，允許 'Admin' 或店家 ID (如 'store202')
        // 以支援店家發佈公告
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
        enum: ['student', 'store', 'all'], // 目標用戶群
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Notification', notificationSchema);