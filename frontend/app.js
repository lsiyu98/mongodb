const BACKEND_URL = 'http://localhost:3001';
const ADMIN_ID = 'admin001';

// DOM 元素 - 確保這裡使用 'broadcastPanel'
const statusEl = document.getElementById('status');
const connectBtn = document.getElementById('connectBtn');
const broadcastPanel = document.getElementById('broadcastPanel'); // 這裡必須是 broadcastPanel
const broadcastRoleStatusEl = document.getElementById('broadcastRoleStatus'); 
const broadcastBtn = document.getElementById('broadcastBtn');
const announcementInput = document.getElementById('announcementInput');
const targetRole = document.getElementById('targetRole');
const announcementMessages = document.getElementById('announcementMessages');
const chatInput = document.getElementById('chatInput');
const receiverIdInput = document.getElementById('receiverId');
const sendChatBtn = document.getElementById('sendChatBtn');
const chatMessages = document.getElementById('chatMessages');

let socket = null;
let currentRole = 'student';
let currentId = 'user101'; // 學生預設ID
let isConnected = false;

// ----------------------------------------------------
// A. SOCKET.IO 連線與註冊邏輯
// ----------------------------------------------------

/** 建立連線並向後端註冊身份 */
function connectAndRegister() {
    if (socket && isConnected) {
        socket.disconnect();
    }
    
    // 根據角色設定 ID 並決定是否顯示公告面板
    const selectedRole = document.querySelector('input[name="role"]:checked').value;
    currentRole = selectedRole;
    
    // 關鍵：根據 currentRole 設定 currentId 和面板顯示狀態
    if (currentRole === 'student') {
        currentId = 'user101';
        broadcastPanel.style.display = 'none'; // 學生隱藏面板
        receiverIdInput.value = 'store202'; // 學生預設與店家聊天
    } else if (currentRole === 'store') {
        currentId = 'store202';
        broadcastPanel.style.display = 'block'; // 店家顯示面板
        broadcastRoleStatusEl.textContent = `目前身份: 店家 (${currentId})`;
        receiverIdInput.value = 'user101'; // 店家預設與學生聊天
    } else if (currentRole === 'admin') {
        currentId = ADMIN_ID;
        broadcastPanel.style.display = 'block'; // 管理員顯示面板
        broadcastRoleStatusEl.textContent = `目前身份: 管理員 (${currentId})`;
        receiverIdInput.value = 'user101'; // 管理員預設與學生聊天
    }

    // 1. 建立 Socket 連線
    socket = io(BACKEND_URL);

    socket.on('connect', () => {
        isConnected = true;
        statusEl.textContent = `已連線 (ID: ${currentId}, 角色: ${currentRole})`;
        statusEl.style.color = 'green';
        
        // 2. 向後端註冊 ID 和 Role
        socket.emit('register_user', { 
            id: currentId, 
            role: currentRole 
        });
        
        // 3. 設定 Socket 監聽事件
        setupSocketListeners();
    });

    socket.on('disconnect', () => {
        isConnected = false;
        statusEl.textContent = '已離線';
        statusEl.style.color = 'red';
    });
}

/** 設置即時事件監聽 */
function setupSocketListeners() {
    // 監聽公告推播 (後端透過 io.to(target).emit 廣播)
    socket.on('new_announcement', (data) => {
        addAnnouncementMessage(`【新公告 - ${data.sender}】：${data.message}`);
    });
    
    // 監聽聊天訊息 (後端透過 io.to(receiverId).emit 單獨發送)
    socket.on('receive_chat_message', (data) => {
        const time = new Date(data.timestamp).toLocaleTimeString();
        addChatMessage(`${data.senderRole} (${data.senderId}) [${time}]： ${data.message}`);
    });
}

// ----------------------------------------------------
// B. DOM 操作與事件處理
// ----------------------------------------------------

// 點擊連線/註冊按鈕
connectBtn.addEventListener('click', () => {
    // connectAndRegister 內部會讀取選中的角色
    connectAndRegister();
});

// 角色選擇變化時，更新 currentRole (確保連線前角色是正確的)
document.querySelectorAll('input[name="role"]').forEach(radio => {
    radio.addEventListener('change', (event) => {
        currentRole = event.target.value;
    });
});

// 首次載入時自動設定預設角色並連線
document.addEventListener('DOMContentLoaded', connectAndRegister);


// 管理員/店家發佈公告 (使用 Axios 發送 POST 請求)
broadcastBtn.addEventListener('click', async () => {
    // 檢查：只有 admin 或 store 可以發佈公告
    if (currentRole !== 'admin' && currentRole !== 'store') { 
        alert('只有管理員或店家才能發佈公告！');
        return;
    }
    const message = announcementInput.value;
    const target = targetRole.value;
    
    if (!message) return alert('請輸入公告內容');

    try {
        // API 路徑改為通用的 /api/broadcast，並傳遞 senderId 和 senderRole
        const response = await axios.post(`${BACKEND_URL}/api/broadcast`, { 
            senderId: currentId, 
            senderRole: currentRole, 
            target: target,
            message: message
        });

        if (response.data.success) {
            addAnnouncementMessage(`(成功發送) ${currentRole} 已向 ${target} 發佈公告: ${message}`);
            announcementInput.value = '';
        } else {
             const errorMessage = response.data.message || '未知錯誤';
             alert(`發佈公告失敗: ${errorMessage}`);
        }
    } catch (error) {
        const errorMessage = error.response?.data?.message || '請檢查後端伺服器是否運行或連線錯誤。';
        alert(`發佈公告失敗，錯誤訊息: ${errorMessage}`);
        console.error('API 錯誤:', error);
    }
});


// 發送聊天訊息
sendChatBtn.addEventListener('click', () => {
    if (!isConnected) return alert('請先連線/註冊身份！');
    
    const message = chatInput.value;
    const receiverId = receiverIdInput.value;

    if (!message || !receiverId) return alert('請輸入訊息和接收者ID');
    
    const chatData = {
        senderId: currentId,
        receiverId: receiverId,
        senderRole: currentRole,
        message: message,
    };

    // 透過 Socket.IO 發送事件給後端
    socket.emit('send_chat_message', chatData);

    // 在自己的聊天室顯示已發送的訊息
    const time = new Date().toLocaleTimeString();
    addChatMessage(`你 (${currentRole}) [${time}]： ${message}`, true);
    chatInput.value = '';
});


// 輔助函數：新增公告訊息到畫面
function addAnnouncementMessage(message) {
    const time = new Date().toLocaleTimeString();
    announcementMessages.innerHTML += `<p style="color: blue; margin: 5px 0;">[${time}] ${message}</p>`;
    announcementMessages.scrollTop = announcementMessages.scrollHeight; // 滾動到底部
}

// 輔助函數：新增聊天訊息到畫面
function addChatMessage(message, isSelf = false) {
    const color = isSelf ? 'green' : 'black';
    chatMessages.innerHTML += `<p style="color: ${color}; margin: 5px 0;">${message}</p>`;
    chatMessages.scrollTop = chatMessages.scrollHeight; // 滾動到底部
}