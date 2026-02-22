import { CdpService } from '../../src/services/cdpService';
import * as http from 'http';
import { WebSocketServer } from 'ws';

describe('CdpService - Target Detection & Connection', () => {
    let service: CdpService;
    let mockHttpServer: http.Server;
    let mockWss: WebSocketServer;
    const testPort = 19222; // Use a distinct port to avoid conflicts
    const fakeWsUrl = `ws://127.0.0.1:${testPort}/devtools/page/test-id`;

    // Mock the HTTP target list
    const mockTargets = [
        {
            type: 'page',
            title: 'Launchpad',
            url: 'file:///some/path/launchpad.html',
            webSocketDebuggerUrl: `ws://127.0.0.1:${testPort}/devtools/page/launchpad-id`
        },
        {
            type: 'page',
            title: 'Antigravity Workspace',
            url: 'file:///some/path/workbench.html',
            webSocketDebuggerUrl: fakeWsUrl
        }
    ];

    beforeAll((done) => {
        // Setup mock HTTP server for /json/list
        mockHttpServer = http.createServer((req, res) => {
            if (req.url === '/json/list') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(mockTargets));
            } else {
                res.writeHead(404);
                res.end();
            }
        });

        mockWss = new WebSocketServer({ server: mockHttpServer });

        mockWss.on('connection', (ws) => {
            // CDP Server mock behavior
            ws.on('message', (message) => {
                const req = JSON.parse(message.toString());
                if (req.method === 'Runtime.enable') {
                    // Send mock execution context created
                    ws.send(JSON.stringify({
                        method: 'Runtime.executionContextCreated',
                        params: {
                            context: { id: 1, name: 'top', url: 'file:///some/path/workbench.html' }
                        }
                    }));
                    ws.send(JSON.stringify({
                        method: 'Runtime.executionContextCreated',
                        params: {
                            context: { id: 2, name: 'cascade-panel', url: 'file:///some/path/cascade-panel.html' }
                        }
                    }));
                    // Reply to the enable request
                    ws.send(JSON.stringify({ id: req.id, result: {} }));
                }
            });
        });

        mockHttpServer.listen(testPort, done);
    });

    afterAll((done) => {
        mockWss.close(() => {
            mockHttpServer.close(done);
        });
    });

    beforeEach(() => {
        // Provide the test port array to restrict search to our test server
        // maxReconnectAttempts: 0 でテスト後の自動再接続タイマーリークを防ぐ
        service = new CdpService({ portsToScan: [testPort], maxReconnectAttempts: 0 });
    });

    afterEach(async () => {
        await service.disconnect();
    });

    it('ポートをスキャンし、正しいターゲット(workbench)を検出してWebSocket URLを取得する', async () => {
        const targetUrl = await service.discoverTarget();
        expect(targetUrl).toBe(fakeWsUrl);
    });

    it('WebSocket接続を確立し、コンテキスト(cascade-panel)を認識する', async () => {
        await service.connect();
        expect(service.isConnected()).toBe(true);

        // Context 取得の完了を少し待つ (モックサーバーのレスポンスを受信するため)
        await new Promise(r => setTimeout(r, 100));

        const contexts = service.getContexts();
        expect(contexts.length).toBeGreaterThanOrEqual(1);

        const targetContextId = service.getPrimaryContextId();
        expect(targetContextId).toBe(2); // cascade-panel.html is id 2
    });

    it('切断された際に、自動再接続のリスナーが動作すること', async () => {
        await service.connect();
        expect(service.isConnected()).toBe(true);

        const disconnectPromise = new Promise<void>(resolve => {
            service.on('disconnected', resolve);
        });

        // モックサーバーから切断を強制
        for (const client of mockWss.clients) {
            client.terminate();
        }

        await disconnectPromise;
        expect(service.isConnected()).toBe(false);
    });
});
