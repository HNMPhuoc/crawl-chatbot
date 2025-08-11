// script.js
document.addEventListener('DOMContentLoaded', () => {
    // ----- CẤU HÌNH -----
    const DB_NAME = 'semantic_search_db_v3';
    const STORE_NAME = 'sentence_embeddings';
    const DB_VERSION = 1;

    // Thay đổi 2 URL này thành webhook n8n của bạn
    const CRAWL_WEBHOOK_URL = 'https://n8n.your-domain.com/webhook/crawl-data';
    const CHAT_WEBHOOK_URL = 'https://n8n.your-domain.com/webhook/chat-query';

    // ----- DOM -----
    const crawlBtn = document.getElementById('crawlBtn');
    const searchBtn = document.getElementById('searchBtn');
    const queryInput = document.getElementById('query');
    const resultDiv = document.getElementById('result');
    const statusP = document.getElementById('status');
    const loader = document.getElementById('loader');

    // Chat UI (nếu HTML không có thì tạo động)
    let chatBubble = document.getElementById('chat-bubble');
    let chatPopup = document.getElementById('chat-popup');
    if (!chatBubble || !chatPopup) {
        // tạo bong bóng chat + popup nếu chưa có
        chatBubble = document.createElement('div');
        chatBubble.id = 'chat-bubble';
        Object.assign(chatBubble.style, {
            position: 'fixed', bottom: '20px', right: '20px',
            background: '#2563eb', color: 'white',
            padding: '12px', borderRadius: '50%', cursor: 'pointer',
            boxShadow: '0 2px 10px rgba(0,0,0,0.3)', zIndex: 9999
        });
        chatBubble.innerText = '💬';
        document.body.appendChild(chatBubble);

        chatPopup = document.createElement('div');
        chatPopup.id = 'chat-popup';
        Object.assign(chatPopup.style, {
            display: 'none', position: 'fixed', bottom: '80px', right: '20px',
            width: '360px', height: '480px', background: 'white',
            borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 9999
        });
        chatPopup.innerHTML = `
            <div style="background:#2563eb; color:white; padding:10px; font-weight:bold;">
                Chatbot
                <span id="close-chat" style="float:right; cursor:pointer;">✖</span>
            </div>
            <div id="chat-messages" style="flex:1; padding:10px; overflow-y:auto; font-size:14px;"></div>
            <div style="display:flex; border-top:1px solid #e5e7eb;">
                <input id="chat-input" type="text" placeholder="Nhập câu hỏi..."
                       style="flex:1; border:none; padding:10px; outline:none;">
                <button id="send-btn" style="background:#2563eb; color:white; border:none; padding:8px 12px; margin:6px; border-radius:6px;">Gửi</button>
            </div>
        `;
        document.body.appendChild(chatPopup);
    }
    const closeChat = chatPopup.querySelector('#close-chat');
    const chatInput = chatPopup.querySelector('#chat-input');
    const sendBtn = chatPopup.querySelector('#send-btn');
    const chatMessages = chatPopup.querySelector('#chat-messages');

    // ----- Biến toàn cục -----
    let model = null;
    let db = null;

    // ----- Helpers -----
    function showResult(message, type = 'info') {
        resultDiv.innerHTML = message;
        resultDiv.className = 'mt-6 p-4 rounded-md min-h-[100px] ';
        const classMap = {
            success: ['bg-green-100', 'text-green-800'],
            error: ['bg-red-100', 'text-red-800'],
            info: ['bg-gray-100', 'text-gray-700']
        };
        resultDiv.classList.add(...(classMap[type] || classMap['info']));
    }

    function escapeHTML(str) {
        const p = document.createElement('p');
        p.appendChild(document.createTextNode(str));
        return p.innerHTML;
    }

    function cosineSimilarity(vecA, vecB) {
        const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
        const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
        const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
        if (magnitudeA === 0 || magnitudeB === 0) return 0;
        return dotProduct / (magnitudeA * magnitudeB);
    }

    // ----- IndexedDB -----
    function openDatabase() {
        return new Promise((resolve, reject) => {
            if (db) return resolve(db);
            const request = window.indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = (event) => reject(event.target.error);
            request.onupgradeneeded = (event) => {
                const tempDb = event.target.result;
                if (!tempDb.objectStoreNames.contains(STORE_NAME)) {
                    tempDb.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                }
            };
            request.onsuccess = (event) => {
                db = event.target.result;
                resolve(db);
            };
        });
    }

    // ----- Tải mô hình USE -----
    async function loadModel() {
        if (model) return model;
        statusP.textContent = 'Đang tải mô hình (chỉ lần đầu)...';
        loader.style.display = 'block';
        try {
            model = await use.load();
            statusP.textContent = 'Mô hình đã sẵn sàng.';
            return model;
        } catch (err) {
            console.error('Lỗi load model:', err);
            statusP.textContent = 'Lỗi tải mô hình.';
            throw err;
        } finally {
            loader.style.display = 'none';
        }
    }

    // ----- Crawl nội dung trang -----
    function crawlPageContent() {
        const data = [];
        // Lấy theo cấu trúc bài: các thẻ H2 trong article và các P theo sau
        const allH2s = document.querySelectorAll('article h2');
        if (allH2s.length === 0) {
            // fallback: lấy tất cả H2 trên trang
            const found = document.querySelectorAll('h2');
            found.forEach(h2 => {
                const title = h2.innerText.trim();
                let currentNode = h2.nextElementSibling;
                while (currentNode && currentNode.tagName !== 'H2') {
                    if (currentNode.tagName === 'P') {
                        const paragraphText = currentNode.innerText.trim();
                        const sentences = paragraphText.split(/[.?!।\n]+/).filter(s => s.trim().length > 5);
                        sentences.forEach(sentence => data.push({ title, sentence: sentence.trim() }));
                    }
                    currentNode = currentNode.nextElementSibling;
                }
            });
            return data;
        }
        allH2s.forEach(h2 => {
            const title = h2.innerText.trim();
            let currentNode = h2.nextElementSibling;
            while (currentNode && currentNode.tagName !== 'H2') {
                if (currentNode.tagName === 'P') {
                    const paragraphText = currentNode.innerText.trim();
                    const sentences = paragraphText.split(/[.?!।\n]+/).filter(s => s.trim().length > 5);
                    sentences.forEach(sentence => data.push({ title, sentence: sentence.trim() }));
                }
                currentNode = currentNode.nextElementSibling;
            }
        });
        return data;
    }

    // ----- Gửi dữ liệu crawl tới n8n -----
    async function sendToN8N(payloadUrl, payload) {
        try {
            const res = await fetch(payloadUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`HTTP ${res.status}: ${text}`);
            }
            return await res.json().catch(() => ({}));
        } catch (err) {
            console.error('Lỗi gửi tới n8n:', err);
            throw err;
        }
    }

    // ----- Xử lý Crawl & Embed (khi nhấn nút) -----
    crawlBtn.addEventListener('click', async () => {
        try {
            crawlBtn.disabled = true;
            searchBtn.disabled = true;
            loader.style.display = 'block';
            statusP.textContent = 'Bắt đầu thu thập dữ liệu...';

            const dbInstance = await openDatabase();
            const crawledData = crawlPageContent();
            if (crawledData.length === 0) {
                throw new Error('Không tìm thấy nội dung (thẻ h2, p) phù hợp.');
            }
            statusP.textContent = `Đã thu thập được ${crawledData.length} câu.`;

            const loadedModel = await loadModel();
            statusP.textContent = 'Đang chuyển đổi câu thành vector...';

            const sentences = crawledData.map(item => item.sentence);
            const embeddingsTensor = await loadedModel.embed(sentences);
            const embeddings = await embeddingsTensor.array();
            embeddingsTensor.dispose();

            const dataToStore = crawledData.map((item, i) => ({
                pageUrl: window.location.href,
                title: item.title,
                sentence: item.sentence,
                embedding: embeddings[i]
            }));

            statusP.textContent = 'Đang lưu dữ liệu vào cơ sở dữ liệu...';
            await new Promise((resolve, reject) => {
                const transaction = dbInstance.transaction(STORE_NAME, 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                transaction.onerror = event => reject(event.target.error);
                transaction.oncomplete = () => resolve();
                store.clear();
                dataToStore.forEach(item => store.add(item));
            });

            // Gửi dữ liệu (có thể gửi cả embedding hoặc chỉ gửi text tùy n8n workflow)
            statusP.textContent = 'Gửi dữ liệu tới n8n...';
            try {
                await sendToN8N(CRAWL_WEBHOOK_URL, {
                    pageUrl: window.location.href,
                    crawledAt: new Date().toISOString(),
                    data: dataToStore
                });
                showResult(`<b>Thành công!</b><br>Đã lưu trữ ${dataToStore.length} câu và gửi tới n8n.`, 'success');
                statusP.textContent = 'Sẵn sàng để tìm kiếm.';
            } catch (err) {
                // nếu gửi n8n lỗi -> vẫn coi là thành công lưu local
                showResult(`<b>Thành công (lưu local)!</b><br>Đã lưu ${dataToStore.length} câu. Gửi n8n thất bại: ${escapeHTML(err.message)}`, 'error');
                statusP.textContent = 'Đã lưu nhưng gửi n8n thất bại.';
            }
        } catch (error) {
            console.error('Lỗi trong quá trình crawl và embed:', error);
            showResult(`Đã xảy ra lỗi: ${escapeHTML(error.message || String(error))}`, 'error');
            statusP.textContent = 'Có lỗi xảy ra.';
        } finally {
            crawlBtn.disabled = false;
            searchBtn.disabled = false;
            loader.style.display = 'none';
        }
    });

    // ----- Tìm kiếm nội bộ (client-side) -----
    searchBtn.addEventListener('click', async () => {
        const query = queryInput.value.trim();
        if (!query) {
            showResult('Vui lòng nhập câu hỏi để tìm kiếm.', 'error');
            return;
        }
        try {
            crawlBtn.disabled = true;
            searchBtn.disabled = true;
            loader.style.display = 'block';
            statusP.textContent = 'Đang tìm kiếm...';

            const dbInstance = await openDatabase();
            const allData = await new Promise((resolve, reject) => {
                const transaction = dbInstance.transaction(STORE_NAME, 'readonly');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.getAll();
                request.onerror = event => reject(event.target.error);
                request.onsuccess = event => resolve(event.target.result);
            });

            if (!allData || allData.length === 0) {
                throw new Error('Cơ sở dữ liệu trống. Vui lòng "Crawl & Embed" trước.');
            }

            const loadedModel = await loadModel();
            const queryEmbeddingTensor = await loadedModel.embed([query]);
            const queryEmbedding = (await queryEmbeddingTensor.array())[0];
            queryEmbeddingTensor.dispose();

            const bestMatch = allData.reduce((best, current) => {
                const similarity = cosineSimilarity(queryEmbedding, current.embedding);
                if (similarity > best.similarity) {
                    return { item: current, similarity };
                }
                return best;
            }, { item: null, similarity: -1 });

            if (bestMatch.item) {
                const { item, similarity } = bestMatch;
                const resultHTML = `
                    <p class="text-sm text-gray-600">Kết quả phù hợp nhất (độ tương đồng: ${similarity.toFixed(4)}):</p>
                    <div class="mt-2 p-3 bg-white border border-blue-200 rounded">
                        <p class="font-semibold text-blue-700">Tiêu đề: ${escapeHTML(item.title)}</p>
                        <p class="mt-1">"${escapeHTML(item.sentence)}"</p>
                        <p class="text-xs text-gray-500 mt-2">Nguồn: ${escapeHTML(item.pageUrl || window.location.href)}</p>
                    </div>
                `;
                showResult(resultHTML, 'success');
            } else {
                showResult('Không tìm thấy kết quả nào phù hợp.', 'info');
            }
            statusP.textContent = 'Tìm kiếm hoàn tất.';
        } catch (error) {
            console.error('Lỗi trong quá trình tìm kiếm:', error);
            showResult(`Đã xảy ra lỗi: ${escapeHTML(error.message || String(error))}`, 'error');
            statusP.textContent = 'Có lỗi xảy ra.';
        } finally {
            crawlBtn.disabled = false;
            searchBtn.disabled = false;
            loader.style.display = 'none';
        }
    });

    // ----- Chat UI handlers -----
    chatBubble.addEventListener('click', () => {
        chatPopup.style.display = 'flex';
    });
    closeChat && closeChat.addEventListener('click', () => {
        chatPopup.style.display = 'none';
    });

    function appendMessage(sender, text) {
        const msg = document.createElement('div');
        msg.style.marginBottom = '10px';
        msg.style.wordBreak = 'break-word';
        msg.innerHTML = `<div style="font-size:12px;color:#6b7280;">${sender}</div><div style="margin-top:4px;">${escapeHTML(text)}</div>`;
        chatMessages.appendChild(msg);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    async function sendQuestionToN8N(question) {
        appendMessage('Bạn', question);
        chatInput.value = '';
        appendMessage('Bot', 'Đang xử lý...');

        try {
            const res = await fetch(CHAT_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question,
                    pageUrl: window.location.href,
                    // Bạn có thể thêm client-side embedding, local context id, v.v. nếu cần
                    clientTime: new Date().toISOString()
                })
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`HTTP ${res.status}: ${text}`);
            }
            const data = await res.json().catch(() => ({}));
            // xóa "Đang xử lý..." (lấy phần tử cuối cùng)
            chatMessages.lastChild && chatMessages.removeChild(chatMessages.lastChild);
            const answer = data.answer || data.reply || data.text || 'Không có câu trả lời từ server.';
            appendMessage('Bot', answer);
        } catch (err) {
            console.error('Lỗi chat webhook:', err);
            // xóa "Đang xử lý..."
            chatMessages.lastChild && chatMessages.removeChild(chatMessages.lastChild);
            appendMessage('Bot', 'Lỗi kết nối tới chatbot. Vui lòng thử lại.');
        }
    }

    sendBtn.addEventListener('click', () => {
        const q = chatInput.value.trim();
        if (q) sendQuestionToN8N(q);
    });
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const q = chatInput.value.trim();
            if (q) sendQuestionToN8N(q);
        }
    });

    // Tự động mở DB khi tải trang
    openDatabase().catch(err => {
        statusP.textContent = `Lỗi khởi tạo DB: ${err}`;
        crawlBtn.disabled = true;
        searchBtn.disabled = true;
    });
});