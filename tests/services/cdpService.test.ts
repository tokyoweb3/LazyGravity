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
                    return;
                }

                if (req.method === 'Network.enable') {
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
        // maxReconnectAttempts: 0 prevents auto-reconnect timer leaks after tests
        service = new CdpService({ portsToScan: [testPort], maxReconnectAttempts: 0 });
    });

    afterEach(async () => {
        await service.disconnect();
    });

    it('scans ports and discovers the correct target (workbench) to obtain the WebSocket URL', async () => {
        const targetUrl = await service.discoverTarget();
        expect(targetUrl).toBe(fakeWsUrl);
    });

    it('establishes a WebSocket connection and recognizes the context (cascade-panel)', async () => {
        await service.connect();
        expect(service.isConnected()).toBe(true);

        // Wait briefly for context retrieval to complete (to receive mock server responses)
        await new Promise(r => setTimeout(r, 100));

        const contexts = service.getContexts();
        expect(contexts.length).toBeGreaterThanOrEqual(1);

        const targetContextId = service.getPrimaryContextId();
        expect(targetContextId).toBe(2); // cascade-panel.html is id 2
    });

    it('triggers the auto-reconnect listener when disconnected', async () => {
        await service.connect();
        expect(service.isConnected()).toBe(true);

        const disconnectPromise = new Promise<void>(resolve => {
            service.on('disconnected', resolve);
        });

        // Force disconnect from the mock server
        for (const client of mockWss.clients) {
            client.terminate();
        }

        await disconnectPromise;
        expect(service.isConnected()).toBe(false);
    });
});
