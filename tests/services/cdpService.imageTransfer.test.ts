import { CdpService } from '../../src/services/cdpService';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

describe('CdpService - 画像転送', () => {
    let service: CdpService;
    let mockHttpServer: http.Server;
    let mockWss: WebSocketServer;
    let serverSocket: WebSocket | null = null;
    const testPort = 19224;
    const fakeWsUrl = `ws://127.0.0.1:${testPort}/devtools/page/test-id`;
    let receivedMessages: any[] = [];
    let evaluateCalls = 0;

    beforeAll((done) => {
        mockHttpServer = http.createServer((req, res) => {
            if (req.url === '/json/list') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify([
                    {
                        type: 'page',
                        title: 'Antigravity Workspace',
                        url: 'file:///workbench/index.html',
                        webSocketDebuggerUrl: fakeWsUrl,
                    },
                ]));
                return;
            }
            res.writeHead(404);
            res.end();
        });

        mockWss = new WebSocketServer({ server: mockHttpServer });
        mockWss.on('connection', (ws) => {
            serverSocket = ws;
            receivedMessages = [];
            evaluateCalls = 0;

            ws.on('message', (message) => {
                const req = JSON.parse(message.toString());
                receivedMessages.push(req);

                if (req.method === 'Runtime.enable') {
                    ws.send(JSON.stringify({
                        method: 'Runtime.executionContextCreated',
                        params: {
                            context: { id: 2, name: 'cascade', url: 'file:///workbench/cascade-panel.html' },
                        },
                    }));
                    ws.send(JSON.stringify({ id: req.id, result: {} }));
                    return;
                }

                if (req.method === 'Runtime.evaluate') {
                    evaluateCalls += 1;

                    if (evaluateCalls === 1) {
                        ws.send(JSON.stringify({
                            id: req.id,
                            result: { result: { value: { ok: true } } },
                        }));
                        return;
                    }

                    if (evaluateCalls === 2) {
                        ws.send(JSON.stringify({
                            id: req.id,
                            result: { result: { value: { ok: true, token: 'agclaw-token' } } },
                        }));
                        return;
                    }

                    if (evaluateCalls === 3) {
                        ws.send(JSON.stringify({
                            id: req.id,
                            result: { result: { value: { ok: true } } },
                        }));
                        return;
                    }

                    ws.send(JSON.stringify({
                        id: req.id,
                        result: {
                            result: {
                                value: [
                                    {
                                        name: 'generated-1.png',
                                        mimeType: 'image/png',
                                        base64Data: Buffer.from('image-data').toString('base64'),
                                    },
                                ],
                            },
                        },
                    }));
                    return;
                }

                if (req.method === 'DOM.enable') {
                    ws.send(JSON.stringify({ id: req.id, result: {} }));
                    return;
                }

                if (req.method === 'DOM.getDocument') {
                    ws.send(JSON.stringify({
                        id: req.id,
                        result: { root: { nodeId: 1 } },
                    }));
                    return;
                }

                if (req.method === 'DOM.querySelector') {
                    ws.send(JSON.stringify({
                        id: req.id,
                        result: { nodeId: 101 },
                    }));
                    return;
                }

                if (req.method === 'DOM.setFileInputFiles') {
                    ws.send(JSON.stringify({ id: req.id, result: {} }));
                    return;
                }

                if (req.method === 'Input.insertText' || req.method === 'Input.dispatchKeyEvent') {
                    ws.send(JSON.stringify({ id: req.id, result: {} }));
                    return;
                }
            });
        });

        mockHttpServer.listen(testPort, done);
    });

    afterAll((done) => {
        mockWss.close(() => mockHttpServer.close(done));
    });

    beforeEach(() => {
        service = new CdpService({ portsToScan: [testPort], maxReconnectAttempts: 0 });
    });

    afterEach(async () => {
        await service.disconnect();
    });

    it('画像ファイルを添付してメッセージ送信できること', async () => {
        await service.connect();
        await new Promise(r => setTimeout(r, 100));

        const result = await service.injectMessageWithImageFiles(
            '画像付きプロンプト',
            ['/tmp/agclaw-a.png', '/tmp/agclaw-b.jpg'],
        );

        expect(result.ok).toBe(true);
        expect(result.contextId).toBe(2);

        const domSetFilesCall = receivedMessages.find((m) => m.method === 'DOM.setFileInputFiles');
        expect(domSetFilesCall).toBeDefined();
        expect(domSetFilesCall.params.files).toEqual(['/tmp/agclaw-a.png', '/tmp/agclaw-b.jpg']);
    });

    it('最新応答の画像データを取得できること', async () => {
        await service.connect();
        await new Promise(r => setTimeout(r, 100));
        evaluateCalls = 3;

        const images = await service.extractLatestResponseImages();
        expect(images).toHaveLength(1);
        expect(images[0]).toEqual(
            expect.objectContaining({
                name: 'generated-1.png',
                mimeType: 'image/png',
                base64Data: expect.any(String),
            }),
        );
    });
});
