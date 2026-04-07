'use strict';

const https = require('https');

const ZHIPU_API_BASE = 'open.bigmodel.cn';

const queue = [];
let isProcessing = false;

const DEFAULT_MODELS = {
    chat: 'glm-4.7-flash',
    vision: 'glm-4.1v-thinking-flash',
    image: 'cogview-3-flash'
};

function makeRequest(options, body) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        resolve(data);
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function callZhipuAPI(apiKey, model, messages, maxTokens = 4096) {
    const body = JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: maxTokens,
        temperature: 0.7,
        stream: true
    });

    return new Promise((resolve, reject) => {
        const options = {
            hostname: ZHIPU_API_BASE,
            port: 443,
            path: '/api/paas/v4/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let fullContent = '';
            let reasoningContent = '';
            let buffer = '';

            res.on('data', (chunk) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;
                        
                        try {
                            const json = JSON.parse(data);
                            const delta = json.choices?.[0]?.delta;
                            if (delta?.content) {
                                fullContent += delta.content;
                            }
                            if (delta?.reasoning_content) {
                                reasoningContent += delta.reasoning_content;
                            }
                        } catch (e) {}
                    }
                }
            });

            res.on('end', () => {
                const finalContent = fullContent || reasoningContent;
                if (finalContent) {
                    resolve(finalContent);
                } else {
                    reject(new Error('Empty response from API'));
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function callZhipuImageAPI(apiKey, model, prompt, size) {
    const body = JSON.stringify({
        model: model,
        prompt: prompt,
        size: size
    });

    const options = {
        hostname: ZHIPU_API_BASE,
        port: 443,
        path: '/api/paas/v4/images/generations',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Content-Length': Buffer.byteLength(body)
        }
    };

    return makeRequest(options, body);
}

async function processQueue() {
    if (isProcessing || queue.length === 0) return;
    
    isProcessing = true;
    const task = queue.shift();
    
    try {
        let result;
        
        switch (task.type) {
            case 'chat':
                result = await callZhipuAPI(task.apiKey, task.model, task.messages, task.maxTokens);
                break;
            case 'vision':
                result = await callZhipuAPI(task.apiKey, task.model, task.messages);
                break;
            case 'image':
                result = await callZhipuImageAPI(task.apiKey, task.model, task.prompt, task.size);
                break;
            default:
                throw new Error('Invalid type');
        }
        
        task.resolve({
            success: true,
            content: result,
            queuePosition: task.position,
            queueRemaining: queue.length
        });
    } catch (err) {
        task.reject(err);
    } finally {
        isProcessing = false;
        processQueue();
    }
}

exports.main = async (event, context) => {
    const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY || '';
    
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        let body;
        if (typeof event.body === 'string') {
            body = JSON.parse(event.body);
        } else {
            body = event.body || event;
        }
        
        const { type, messages, model, prompt, size, maxTokens } = body;

        if (!ZHIPU_API_KEY) {
            return {
                statusCode: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    success: false,
                    error: 'API Key未配置，请在环境变量中设置ZHIPU_API_KEY'
                })
            };
        }

        const position = queue.length;

        return new Promise((resolve) => {
            queue.push({
                type: type,
                apiKey: ZHIPU_API_KEY,
                model: model || DEFAULT_MODELS[type] || DEFAULT_MODELS.chat,
                messages: messages,
                prompt: prompt,
                size: size || '1024x1024',
                maxTokens: maxTokens || 4096,
                position: position,
                resolve: (result) => {
                    resolve({
                        statusCode: 200,
                        headers: {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        },
                        body: JSON.stringify(result)
                    });
                },
                reject: (err) => {
                    resolve({
                        statusCode: 500,
                        headers: {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        },
                        body: JSON.stringify({
                            success: false,
                            error: err.message
                        })
                    });
                }
            });
            
            processQueue();
        });

    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: false,
                error: error.message
            })
        };
    }
};
