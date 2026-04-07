let uploadedFiles = [];
let processedData = null;
let generatedImageUrl = null;
let apiConfig = null;
let isApiRequestInProgress = false;
let apiRequestQueue = [];
let chatHistory = [];
let cloudbaseApp = null;

const DEFAULT_MODELS = {
    text: 'glm-4.7-flash',
    vision: 'glm-4.1v-thinking-flash',
    image: 'cogview-3-flash'
};

async function initCloudBase() {
    if (cloudbaseApp) return cloudbaseApp;
    
    cloudbaseApp = cloudbase.init({
        env: 'first-my-cloudbase-3dcmv2ddd0522',
        region: 'ap-shanghai'
    });
    
    const auth = cloudbaseApp.auth({ persistence: 'local' });
    const loginState = auth.hasLoginState();
    
    if (!loginState) {
        console.log('正在进行匿名登录...');
        await auth.anonymousAuthProvider().signIn();
        console.log('匿名登录成功');
    } else {
        console.log('已登录');
    }
    
    return cloudbaseApp;
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function callCloudFunction(params) {
    const app = await initCloudBase();
    
    try {
        const result = await app.callFunction({
            name: 'smarttable-api',
            data: params
        });
        
        if (result.result && typeof result.result === 'object') {
            if (!result.result.success && result.result.error) {
                throw new Error(result.result.error);
            }
            return result.result;
        }
        
        return result.result;
    } catch (error) {
        console.error('云函数调用错误:', error);
        throw error;
    }
}

async function waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
        console.log(`请求限流保护，等待 ${waitTime}ms...`);
        showLoading(`请求限流保护，等待中...`);
        await sleep(waitTime);
    }
    
    lastRequestTime = Date.now();
}

async function processApiRequest(requestFn) {
    if (isApiRequestInProgress) {
        return new Promise((resolve, reject) => {
            apiRequestQueue.push({ fn: requestFn, resolve, reject });
        });
    }
    
    isApiRequestInProgress = true;
    
    try {
        await waitForRateLimit();
        const result = await requestFn();
        
        if (apiRequestQueue.length > 0) {
            const next = apiRequestQueue.shift();
            isApiRequestInProgress = false;
            next.resolve(await processApiRequest(next.fn));
        }
        
        return result;
    } catch (error) {
        if (apiRequestQueue.length > 0) {
            const next = apiRequestQueue.shift();
            isApiRequestInProgress = false;
            try {
                next.resolve(await processApiRequest(next.fn));
            } catch (e) {
                next.reject(e);
            }
        }
        throw error;
    } finally {
        if (apiRequestQueue.length === 0) {
            isApiRequestInProgress = false;
        }
    }
}

async function fetchWithTimeout(url, options, timeout = API_TIMEOUT) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
        console.log('发送请求到:', url);
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        console.log('收到响应:', response.status);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error('请求超时（' + Math.round(timeout/1000) + '秒），可能是网络较慢或API服务器繁忙，请稍后重试');
        }
        console.error('网络错误:', error);
        throw new Error('网络连接失败: ' + error.message);
    }
}

async function fetchWithRetry(url, options, timeout = API_TIMEOUT) {
    const response = await fetchWithTimeout(url, options, timeout);
    
    if (response.status === 429) {
        throw new Error('当前平台算力拥堵，请稍后再试');
    }
    
    if (response.status === 500 || response.status === 502 || response.status === 503) {
        throw new Error('服务器繁忙，请稍后再试');
    }
    
    return response;
}

document.addEventListener('DOMContentLoaded', function() {
    loadApiConfig();
    updateApiStatus();
    
    const fileInput = document.getElementById('fileInput');
    const uploadArea = document.getElementById('uploadArea');
    
    uploadArea.addEventListener('dragover', function(e) {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    
    uploadArea.addEventListener('dragleave', function(e) {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
    });
    
    uploadArea.addEventListener('drop', function(e) {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const files = e.dataTransfer.files;
        handleFiles(files);
    });
    
    fileInput.addEventListener('change', function(e) {
        handleFiles(e.target.files);
    });
});

function handleFiles(files) {
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!uploadedFiles.find(f => f.name === file.name && f.size === file.size)) {
            uploadedFiles.push(file);
        }
    }
    renderFileList();
}

function renderFileList() {
    const fileList = document.getElementById('fileList');
    fileList.innerHTML = '';
    
    uploadedFiles.forEach((file, index) => {
        const fileType = getFileType(file.name);
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
            <div class="file-info">
                <div>
                    <div class="file-name">${file.name}</div>
                    <div class="file-size">${formatFileSize(file.size)}</div>
                </div>
                <span class="file-type">${fileType}</span>
            </div>
            <button class="remove-file" onclick="removeFile(${index})">删除</button>
        `;
        fileList.appendChild(fileItem);
    });
}

function getFileType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const typeMap = {
        'xlsx': 'Excel',
        'xls': 'Excel',
        'csv': 'CSV',
        'json': 'JSON',
        'docx': 'Word',
        'doc': 'Word',
        'png': '图片',
        'jpg': '图片',
        'jpeg': '图片',
        'gif': '图片',
        'bmp': '图片'
    };
    return typeMap[ext] || '文件';
}

function isImageFile(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return ['png', 'jpg', 'jpeg', 'gif', 'bmp'].includes(ext);
}

function removeFile(index) {
    uploadedFiles.splice(index, 1);
    renderFileList();
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function showLoading(text) {
    document.getElementById('loadingText').textContent = text;
    document.getElementById('loadingOverlay').style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === tabName) {
            btn.classList.add('active');
        }
    });
    
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    document.getElementById(`tab-${tabName}`).classList.add('active');
}

async function processFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    
    switch (ext) {
        case 'xlsx':
        case 'xls':
        case 'csv':
        case 'json':
            return await readExcelOrCsv(file);
        case 'docx':
        case 'doc':
            return await readWordDocument(file);
        default:
            throw new Error('不支持的文件格式: ' + ext);
    }
}

async function readExcelOrCsv(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet);
                resolve(jsonData);
            } catch (error) {
                reject(error);
            }
        };
        
        reader.onerror = function(error) {
            reject(error);
        };
        
        reader.readAsArrayBuffer(file);
    });
}

async function readWordDocument(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = async function(e) {
            try {
                const arrayBuffer = e.target.result;
                const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
                const text = result.value;
                
                const parsedData = parseDocumentText(text);
                resolve(parsedData);
            } catch (error) {
                reject(error);
            }
        };
        
        reader.onerror = function(error) {
            reject(error);
        };
        
        reader.readAsArrayBuffer(file);
    });
}

function parseDocumentText(text) {
    const lines = text.split('\n').filter(line => line.trim());
    const data = [];
    
    let currentItem = {};
    let headers = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const colonMatch = line.match(/^(.+?)[：:]\s*(.+)$/);
        if (colonMatch) {
            const key = colonMatch[1].trim();
            const value = colonMatch[2].trim();
            
            if (!headers.includes(key)) {
                headers.push(key);
            }
            
            if (Object.keys(currentItem).length === 0 || headers.indexOf(key) === 0) {
                if (Object.keys(currentItem).length > 0) {
                    data.push(currentItem);
                }
                currentItem = {};
            }
            
            currentItem[key] = value;
        } else {
            const numberedMatch = line.match(/^(\d+)[.、\s]+(.+)$/);
            if (numberedMatch) {
                if (Object.keys(currentItem).length > 0) {
                    data.push(currentItem);
                }
                currentItem = {
                    '序号': numberedMatch[1],
                    '内容': numberedMatch[2]
                };
                if (!headers.includes('序号')) headers.push('序号');
                if (!headers.includes('内容')) headers.push('内容');
            } else {
                if (Object.keys(currentItem).length === 0) {
                    currentItem = { '内容': line };
                    if (!headers.includes('内容')) headers.push('内容');
                } else {
                    const lastKey = Object.keys(currentItem).pop();
                    if (typeof currentItem[lastKey] === 'string') {
                        currentItem[lastKey] += ' ' + line;
                    }
                }
            }
        }
    }
    
    if (Object.keys(currentItem).length > 0) {
        data.push(currentItem);
    }
    
    if (data.length === 0) {
        data.push({
            '原始内容': text.substring(0, 1000)
        });
    }
    
    return data;
}

async function processTableWithAI() {
    if (isApiRequestInProgress) {
        alert('请等待当前请求完成后再操作');
        return;
    }
    
    if (!apiConfig) {
        alert('请先配置API');
        openApiModal();
        return;
    }
    
    const requestInput = document.getElementById('requestInput').value.trim();
    
    if (uploadedFiles.length === 0 && !requestInput) {
        alert('请先上传文件或输入处理请求');
        return;
    }
    
    let allData = [];
    
    for (const file of uploadedFiles) {
        try {
            showLoading(`正在处理: ${file.name}`);
            const fileData = await processFile(file);
            if (fileData && fileData.length > 0) {
                allData = allData.concat(fileData);
            }
        } catch (error) {
            console.error('读取文件失败:', error);
            alert('读取文件失败: ' + file.name + '\n错误: ' + error.message);
            hideLoading();
            return;
        }
    }
    
    if (requestInput && allData.length > 0) {
        showLoading('AI 正在智能处理表格...');
        isApiRequestInProgress = true;
        try {
            const processedResult = await callTextModel(requestInput, allData);
            if (processedResult) {
                allData = processedResult;
            }
        } catch (error) {
            console.error('AI处理失败:', error);
            alert('AI处理失败: ' + error.message);
            hideLoading();
            isApiRequestInProgress = false;
            return;
        } finally {
            isApiRequestInProgress = false;
        }
    } else if (requestInput && allData.length === 0) {
        showLoading('AI 正在生成表格...');
        isApiRequestInProgress = true;
        try {
            const textData = await callTextModel(`请将以下文本内容整理成表格数据，返回JSON数组格式：\n\n${requestInput}`, null);
            if (textData && textData.length > 0) {
                allData = textData;
            }
        } catch (error) {
            console.error('AI处理失败:', error);
            alert('AI处理失败: ' + error.message);
            hideLoading();
            isApiRequestInProgress = false;
            return;
        } finally {
            isApiRequestInProgress = false;
        }
    }
    
    hideLoading();
    
    if (allData.length === 0) {
        alert('没有可处理的数据');
        return;
    }
    
    processedData = allData;
    renderTable(processedData);
    document.getElementById('previewSection').style.display = 'block';
    hideImageResult();
}

async function ocrImageToTable() {
    if (isApiRequestInProgress) {
        alert('请等待当前请求完成后再操作');
        return;
    }
    
    if (!apiConfig) {
        alert('请先配置模型');
        openApiModal();
        return;
    }
    
    const imageFiles = uploadedFiles.filter(f => isImageFile(f.name));
    
    if (imageFiles.length === 0) {
        alert('请先上传图片文件（支持 png, jpg, jpeg, gif, bmp）');
        return;
    }
    
    if (imageFiles.length > 1) {
        alert('⚠️ 为避免API频率限制，一次只能处理一张图片。\n\n当前已上传 ' + imageFiles.length + ' 张图片，将只处理第一张: ' + imageFiles[0].name);
    }
    
    const imageFile = imageFiles[0];
    const ocrPrompt = document.getElementById('ocrPrompt').value.trim();
    
    isApiRequestInProgress = true;
    showLoading(`AI 正在识别图片: ${imageFile.name}`);
    
    try {
        const base64Image = await fileToBase64(imageFile);
        const result = await callVisionModel(base64Image, ocrPrompt);
        
        isApiRequestInProgress = false;
        hideLoading();
        
        if (!result || result.length === 0) {
            alert('未能从图片中识别出表格数据');
            return;
        }
        
        processedData = result;
        renderTable(processedData);
        document.getElementById('previewSection').style.display = 'block';
        hideImageResult();
    } catch (error) {
        console.error('图片识别失败:', error);
        alert('图片识别失败: ' + imageFile.name + '\n错误: ' + error.message);
        hideLoading();
        isApiRequestInProgress = false;
    }
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function callTextModel(request, currentData) {
    const model = apiConfig.textModel || DEFAULT_MODELS.text;
    
    let systemPrompt = `你是一个表格数据处理助手。用户会给你处理表格数据的请求，你需要理解请求并返回处理后的数据。
返回格式必须是JSON数组，每个元素是一个对象，代表一行数据。
只返回JSON数据，不要包含任何其他说明文字、markdown代码块标记或解释。`;

    let userMessage = request;
    
    if (currentData && currentData.length > 0) {
        systemPrompt += `\n\n当前表格数据如下（JSON格式）：\n${JSON.stringify(currentData, null, 2)}`;
        userMessage = `请根据以下请求处理表格数据：\n${request}\n\n返回处理后的完整表格数据（JSON数组格式，不要包含markdown代码块标记）。`;
    }
    
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
    ];
    
    console.log('文本模型请求:', model, '请求内容:', userMessage.substring(0, 100));
    
    const result = await callCloudFunction({
        type: 'chat',
        model: model,
        messages: messages,
        maxTokens: 8192
    });
    
    if (result && result.content) {
        return parseAIResponse({ choices: [{ message: { content: result.content } }] });
    }
    return parseAIResponse(result);
}

function parseAIResponse(responseData) {
    console.log('API完整响应:', JSON.stringify(responseData, null, 2));
    
    const message = responseData.choices?.[0]?.message;
    let content = message?.content || '';
    const reasoningContent = message?.reasoning_content || '';
    const finishReason = responseData.choices?.[0]?.finish_reason;
    
    if (finishReason === 'length') {
        console.warn('输出被截断，可能需要增加max_tokens');
    }
    
    if (!content && reasoningContent) {
        console.log('使用reasoning_content作为响应内容');
        content = reasoningContent;
    }
    
    if (!content) {
        console.error('API响应格式异常:', responseData);
        const errorMsg = responseData.error?.message || responseData.msg || '未知错误';
        throw new Error('API返回数据格式错误: ' + errorMsg);
    }
    
    console.log('AI返回内容:', content.substring(0, 500));
    
    try {
        let jsonStr = content;
        
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1].trim();
        } else {
            const arrayMatch = content.match(/\[[\s\S]*\]/);
            if (arrayMatch) {
                jsonStr = arrayMatch[0];
            } else {
                const objectMatch = content.match(/\{[\s\S]*\}/);
                if (objectMatch) {
                    jsonStr = '[' + objectMatch[0] + ']';
                }
            }
        }
        
        console.log('尝试解析JSON:', jsonStr.substring(0, 200));
        const result = JSON.parse(jsonStr);
        
        if (!Array.isArray(result)) {
            return [result];
        }
        
        return result;
    } catch (e) {
        console.error('解析AI返回的JSON失败，原始内容:', content);
        console.error('解析错误:', e.message);
        throw new Error('AI返回的数据格式无法解析为表格。原始响应: ' + content.substring(0, 100));
    }
}

async function callVisionModel(base64Image, extraPrompt) {
    const model = apiConfig.visionModel || DEFAULT_MODELS.vision;
    
    let prompt = `请仔细分析这张图片，识别其中的表格数据或结构化信息。
将识别到的内容转换为JSON数组格式返回，每个元素是一个对象，代表一行数据。
如果图片中包含表格，请保持表格结构；如果是其他内容，请合理组织成表格形式。
只返回JSON数据，不要包含任何其他说明文字或markdown代码块标记。`;
    
    if (extraPrompt) {
        prompt += `\n\n额外要求：${extraPrompt}`;
    }
    
    const imageUrl = `data:image/jpeg;base64,${base64Image}`;
    
    const messages = [
        {
            role: 'user',
            content: [
                {
                    type: 'image_url',
                    image_url: {
                        url: imageUrl
                    }
                },
                {
                    type: 'text',
                    text: prompt
                }
            ]
        }
    ];
    
    console.log('视觉模型请求:', model, '图片长度:', base64Image.length);
    
    const result = await callCloudFunction({
        type: 'vision',
        model: model,
        messages: messages
    });
    
    if (result && result.content) {
        return parseVisionResponse({ choices: [{ message: { content: result.content } }] });
    }
    return parseVisionResponse(result);
}

function parseVisionResponse(responseData) {
    console.log('视觉API完整响应:', JSON.stringify(responseData, null, 2));
    
    const message = responseData.choices?.[0]?.message;
    let content = message?.content || '';
    const reasoningContent = message?.reasoning_content || '';
    const finishReason = responseData.choices?.[0]?.finish_reason;
    
    if (finishReason === 'length') {
        console.warn('输出被截断，可能需要增加max_tokens');
    }
    
    if (!content && reasoningContent) {
        console.log('使用reasoning_content作为响应内容');
        content = reasoningContent;
    }
    
    if (!content) {
        console.error('API响应格式异常:', responseData);
        const errorMsg = responseData.error?.message || responseData.msg || '未知错误';
        throw new Error('API返回数据格式错误: ' + errorMsg);
    }
    
    console.log('AI返回内容:', content.substring(0, 500));
    
    try {
        let jsonStr = content;
        
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1].trim();
        } else {
            const arrayMatch = content.match(/\[[\s\S]*\]/);
            if (arrayMatch) {
                jsonStr = arrayMatch[0];
            } else {
                const objectMatch = content.match(/\{[\s\S]*\}/);
                if (objectMatch) {
                    jsonStr = '[' + objectMatch[0] + ']';
                }
            }
        }
        
        console.log('尝试解析JSON:', jsonStr.substring(0, 200));
        const result = JSON.parse(jsonStr);
        
        if (!Array.isArray(result)) {
            return [result];
        }
        
        return result;
    } catch (e) {
        console.error('解析AI返回的JSON失败，原始内容:', content);
        console.error('解析错误:', e.message);
        throw new Error('AI返回的数据格式无法解析为表格。原始响应: ' + content.substring(0, 100));
    }
}

async function generateImage() {
    if (isApiRequestInProgress) {
        alert('请等待当前请求完成后再操作');
        return;
    }
    
    if (!apiConfig) {
        alert('请先配置模型');
        openApiModal();
        return;
    }
    
    const prompt = document.getElementById('imagePrompt').value.trim();
    const size = document.getElementById('imageSize').value;
    
    if (!prompt) {
        alert('请输入图片描述');
        return;
    }
    
    showLoading('AI 正在生成图片...');
    
    isApiRequestInProgress = true;
    
    try {
        const model = apiConfig.imageModel || DEFAULT_MODELS.image;
        
        const result = await callCloudFunction({
            type: 'image',
            model: model,
            prompt: prompt,
            size: size
        });
        
        if (result && result.content && result.content.data && result.content.data.length > 0) {
            const imageUrl = result.content.data[0].url;
            generatedImageUrl = imageUrl;
            
            const imageContainer = document.getElementById('imageContainer');
            imageContainer.innerHTML = `<img src="${imageUrl}" alt="AI生成的图片">`;
            
            document.getElementById('imageResultSection').style.display = 'block';
            hidePreview();
        } else {
            throw new Error('未能获取生成的图片');
        }
        
        hideLoading();
        isApiRequestInProgress = false;
    } catch (error) {
        console.error('图片生成失败:', error);
        isApiRequestInProgress = false;
        alert('图片生成失败: ' + error.message);
        hideLoading();
    }
}

async function sendChatMessage() {
    if (isApiRequestInProgress) {
        alert('请等待当前请求完成后再操作');
        return;
    }
    
    if (!apiConfig) {
        alert('请先配置模型');
        openApiModal();
        return;
    }
    
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (!message) {
        alert('请输入问题');
        return;
    }
    
    addChatMessage('user', message);
    input.value = '';
    
    showTypingIndicator();
    
    isApiRequestInProgress = true;
    
    chatHistory.push({ role: 'user', content: message });
    
    try {
        const model = apiConfig.textModel || DEFAULT_MODELS.text;
        
        const messages = [
            { role: 'system', content: '你是一个友好、专业的AI助手。请用中文回答用户的问题，回答要清晰、有条理。' },
            ...chatHistory.slice(-10)
        ];
        
        const result = await callCloudFunction({
            type: 'chat',
            model: model,
            messages: messages,
            maxTokens: 2048
        });
        
        let responseText = '';
        if (result && result.content) {
            responseText = result.content;
        }
        
        if (!responseText) {
            throw new Error('AI返回内容为空');
        }
        
        chatHistory.push({ role: 'assistant', content: responseText });
        addChatMessage('assistant', responseText);
        
        isApiRequestInProgress = false;
    } catch (error) {
        hideTypingIndicator();
        chatHistory.pop();
        isApiRequestInProgress = false;
        console.error('对话请求失败:', error);
        addChatMessage('assistant', '❌ 请求失败: ' + error.message);
    }
}

function addChatMessage(role, content) {
    const container = document.getElementById('chatMessages');
    const welcome = container.querySelector('.chat-welcome');
    if (welcome) {
        welcome.remove();
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}`;
    messageDiv.innerHTML = `<div class="chat-message-content">${escapeHtml(content)}</div>`;
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
}

function showTypingIndicator() {
    const container = document.getElementById('chatMessages');
    const typingDiv = document.createElement('div');
    typingDiv.className = 'chat-message assistant';
    typingDiv.id = 'typingIndicator';
    typingDiv.innerHTML = `<div class="chat-typing"><div class="chat-typing-dots"><span></span><span></span><span></span></div></div>`;
    container.appendChild(typingDiv);
    container.scrollTop = container.scrollHeight;
}

function hideTypingIndicator() {
    const typing = document.getElementById('typingIndicator');
    if (typing) {
        typing.remove();
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function clearChat() {
    chatHistory = [];
    const container = document.getElementById('chatMessages');
    container.innerHTML = `
        <div class="chat-welcome">
            <p>👋 你好！我是AI助手，有什么可以帮助你的吗？</p>
            <p class="chat-tips">
                你可以问我：<br>
                • 各种问题和知识<br>
                • 帮你写文案、代码<br>
                • 分析和总结内容<br>
                • 翻译和润色文字
            </p>
        </div>
    `;
}

function renderTable(data) {
    const tableContainer = document.getElementById('tableContainer');
    
    if (!data || data.length === 0) {
        tableContainer.innerHTML = '<p style="color: #9ca3af; text-align: center; padding: 40px;">暂无数据</p>';
        return;
    }
    
    const headers = Object.keys(data[0]);
    
    let tableHTML = '<table>';
    tableHTML += '<thead><tr>';
    headers.forEach(header => {
        tableHTML += `<th>${header}</th>`;
    });
    tableHTML += '</tr></thead>';
    tableHTML += '<tbody>';
    
    data.forEach(row => {
        tableHTML += '<tr>';
        headers.forEach(header => {
            tableHTML += `<td>${row[header] !== undefined && row[header] !== null ? row[header] : ''}</td>`;
        });
        tableHTML += '</tr>';
    });
    
    tableHTML += '</tbody></table>';
    tableContainer.innerHTML = tableHTML;
}

function hidePreview() {
    document.getElementById('previewSection').style.display = 'none';
}

function hideImageResult() {
    document.getElementById('imageResultSection').style.display = 'none';
}

function clearAll() {
    uploadedFiles = [];
    processedData = null;
    document.getElementById('fileList').innerHTML = '';
    document.getElementById('fileInput').value = '';
    document.getElementById('requestInput').value = '';
    document.getElementById('ocrPrompt').value = '';
    hidePreview();
}

function clearImagePrompt() {
    document.getElementById('imagePrompt').value = '';
}

function exportTable() {
    if (!processedData || processedData.length === 0) {
        alert('没有可导出的数据');
        return;
    }
    
    const worksheet = XLSX.utils.json_to_sheet(processedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    XLSX.writeFile(workbook, '涛哥帮帮忙_导出表格_' + new Date().getTime() + '.xlsx');
}

function downloadImage() {
    if (!generatedImageUrl) {
        alert('没有可下载的图片');
        return;
    }
    
    const link = document.createElement('a');
    link.href = generatedImageUrl;
    link.download = 'AI生成图片_' + new Date().getTime() + '.png';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function openApiModal() {
    const modal = document.getElementById('apiModal');
    modal.style.display = 'flex';
    
    if (apiConfig) {
        document.getElementById('textModel').value = apiConfig.textModel || DEFAULT_MODELS.text;
        document.getElementById('visionModel').value = apiConfig.visionModel || DEFAULT_MODELS.vision;
        document.getElementById('imageModel').value = apiConfig.imageModel || DEFAULT_MODELS.image;
    }
}

function closeApiModal() {
    document.getElementById('apiModal').style.display = 'none';
}

function saveApiConfig() {
    const textModel = document.getElementById('textModel').value;
    const visionModel = document.getElementById('visionModel').value;
    const imageModel = document.getElementById('imageModel').value;
    
    apiConfig = {
        textModel: textModel,
        visionModel: visionModel,
        imageModel: imageModel
    };
    
    localStorage.setItem('smartTableApiConfig', JSON.stringify(apiConfig));
    
    updateApiStatus();
    alert('API配置已保存');
    closeApiModal();
}

function loadApiConfig() {
    const saved = localStorage.getItem('smartTableApiConfig');
    if (saved) {
        try {
            apiConfig = JSON.parse(saved);
        } catch (e) {
            console.error('加载配置失败:', e);
        }
    }
}

function updateApiStatus() {
    const statusEl = document.getElementById('apiStatus');
    const statusText = statusEl.querySelector('.status-text');
    
    if (apiConfig) {
        statusEl.classList.add('configured');
        statusText.textContent = '已配置';
    } else {
        statusEl.classList.remove('configured');
        statusText.textContent = '请配置模型';
    }
}

function openTestModal() {
    const apiKey = document.getElementById('apiKey').value.trim();
    
    if (!apiKey) {
        alert('请先输入API Key');
        return;
    }
    
    document.getElementById('testModal').style.display = 'flex';
    updateTestModelSelect();
}

function closeTestModal() {
    document.getElementById('testModal').style.display = 'none';
}

function updateTestModelSelect() {
    const apiType = document.getElementById('testApiType').value;
    const modelSelect = document.getElementById('testModelSelect');
    
    const models = {
        text: [
            { value: 'glm-4.7-flash', name: 'GLM-4.7-Flash (推荐)' },
            { value: 'glm-4-flash', name: 'GLM-4-Flash' },
            { value: 'glm-4-flashx-250414', name: 'GLM-4-FlashX' }
        ],
        vision: [
            { value: 'glm-4.1v-thinking-flash', name: 'GLM-4.1V-Thinking-Flash (推荐)' },
            { value: 'glm-4.6v-flash', name: 'GLM-4.6V-Flash' },
            { value: 'glm-4v-flash', name: 'GLM-4V-Flash' }
        ],
        image: [
            { value: 'cogview-3-flash', name: 'CogView-3-Flash' }
        ]
    };
    
    modelSelect.innerHTML = '';
    models[apiType].forEach(model => {
        const option = document.createElement('option');
        option.value = model.value;
        option.textContent = model.name;
        modelSelect.appendChild(option);
    });
}

async function testSelectedModel() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const apiType = document.getElementById('testApiType').value;
    const model = document.getElementById('testModelSelect').value;
    
    if (!apiKey) {
        alert('请先输入API Key');
        return;
    }
    
    closeTestModal();
    showLoading(`正在测试 ${model}...`);
    
    try {
        if (apiType === 'image') {
            await testImageModel(apiKey, model);
        } else {
            await testChatModel(apiKey, model);
        }
    } catch (error) {
        hideLoading();
        console.error('API测试失败:', error);
        alert('❌ API连接失败: ' + error.message);
    }
}

async function testChatModel(apiKey, model) {
    const response = await fetchWithRetry(`${ZHIPU_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: 'user', content: '你好，请回复"连接成功"' }
            ],
            max_tokens: 50
        })
    }, 30000, 2);
    
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 429) {
            throw new Error('API调用频率超限，请稍后再试');
        }
        throw new Error(errorData.error?.message || `API请求失败: ${response.status}`);
    }
    
    const data = await response.json();
    hideLoading();
    
    if (data.choices && data.choices[0]) {
        const content = data.choices[0].message.content || data.choices[0].message.reasoning_content || '无响应内容';
        alert('✅ API连接成功！\n\n模型: ' + model + '\n响应: ' + content.substring(0, 100));
    } else {
        alert('⚠️ API响应异常，请检查API Key是否正确');
    }
}

async function testImageModel(apiKey, model) {
    const response = await fetchWithRetry(`${ZHIPU_API_BASE}/images/generations`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            prompt: '一只可爱的小猫',
            size: '256x256'
        })
    }, 60000, 2);
    
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 429) {
            throw new Error('API调用频率超限，请稍后再试');
        }
        throw new Error(errorData.error?.message || `API请求失败: ${response.status}`);
    }
    
    const data = await response.json();
    hideLoading();
    
    if (data.data && data.data.length > 0) {
        alert('✅ API连接成功！\n\n模型: ' + model + '\n图片已生成');
    } else {
        alert('⚠️ API响应异常，请检查API Key是否正确');
    }
}

document.addEventListener('click', function(e) {
    const apiModal = document.getElementById('apiModal');
    const testModal = document.getElementById('testModal');
    
    if (e.target === apiModal) {
        closeApiModal();
    }
    if (e.target === testModal) {
        closeTestModal();
    }
});
