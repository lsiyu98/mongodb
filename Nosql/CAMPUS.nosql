const mongoose = require('mongoose');
const MONGODB_URI = 'mongodb://localhost:27017/CampusFoodDB';

const connectDB = async () => {
    try {
        await mongoose.connect(MONGODB_URI, { /* ... options */ });
        console.log('MongoDB 連線成功...');
    } catch (err) {
        console.error('MongoDB 連線失敗:', err);
        process.exit(1);
    }
};

module.exports = connectDB; // 必須要輸出函式