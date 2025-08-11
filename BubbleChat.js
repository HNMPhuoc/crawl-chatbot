// Giả lập hàm askAI - thay thế bằng import thực tế của bạn
// async function askAI(question) {
//     // Simulated delay
//     await new Promise(resolve => setTimeout(resolve, 1000));
//     return `Đây là câu trả lời cho: "${question}". Tôi đang học và cải thiện để trả lời tốt hơn!`;
// }

const chatBubble = document.getElementById('chat-bubble');
const chatPopup = document.getElementById('chat-popup');
const closeChat = document.getElementById('close-chat');
const sendBtn = document.getElementById('send-btn');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');
const typingIndicator = document.getElementById('typing-indicator');

// Mở chat
chatBubble.addEventListener('click', () => {
    chatPopup.classList.add('open');
    chatBubble.style.display = 'none';
    chatInput.focus();
});

// Đóng chat
closeChat.addEventListener('click', () => {
    chatPopup.classList.remove('open');
    setTimeout(() => {
        chatBubble.style.display = 'flex';
    }, 300);
});

// Gửi câu hỏi
sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

async function sendMessage() {
    const question = chatInput.value.trim();
    if (!question) return;

    addMessage('user', question);
    chatInput.value = '';

    // Hiển thị typing indicator
    showTypingIndicator();

    try {
        const answer = await window.askAI(question);
        hideTypingIndicator();
        addMessage('bot', answer);
    } catch (error) {
        hideTypingIndicator();
        addMessage('bot', 'Xin lỗi, có lỗi xảy ra. Vui lòng thử lại sau.');
    }
}

function addMessage(sender, text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';

    if (sender === 'user') {
        avatar.textContent = '👤';
    } else {
        avatar.innerHTML = '<img src="../AI.png" alt="AI" onerror="this.style.display=\'none\'; this.parentElement.innerHTML=\'🤖\';">';
    }

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = text;

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);

    // Insert before typing indicator
    chatMessages.insertBefore(messageDiv, typingIndicator);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showTypingIndicator() {
    typingIndicator.classList.add('show');
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function hideTypingIndicator() {
    typingIndicator.classList.remove('show');
}

// Click outside để đóng chat
document.addEventListener('click', (e) => {
    if (!chatPopup.contains(e.target) && !chatBubble.contains(e.target)) {
        if (chatPopup.classList.contains('open')) {
            closeChat.click();
        }
    }
});