import { CdpService } from '../../src/services/cdpService';
import * as http from 'http';
import { WebSocketServer } from 'ws';

describe('CdpService - Antigravity 1.107+ compatibility (no cascade-panel context)', () => {
    let service: CdpService;
    let mockHttpServer: http.Server;
    let mockWss: WebSocketServer;
    const testPort = 19223; // Distinct port from cdpService.test.ts (19222)
    const fakeWsUrl = `ws://127.0.0.1:${testPort}/devtools/page/test-id`;

    const mockTargets = [
        {
            type: 'page',
            title: 'my-project',
            url: 'vscode-file://vscode-app/Applications/Antigravity.app/Contents/Resources/app/out/vs/code/electron-browser/workbench/workbench.html',
            webSocketDebuggerUrl: fakeWsUrl,
        },
    ];

    /**
     * Simulates Antigravity 1.107+ which no longer exposes a cascade-panel iframe.
     * Only the top-level workbench context is reported.
     */
    const setupMockServerWithoutCascadePanel = (done: () => void) => {
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
            ws.on('message', (message) => {
                const req = JSON.parse(message.toString());

                if (req.method === 'Runtime.enable') {
                    // Only emit the main workbench context — NO cascade-panel
                    ws.send(JSON.stringify({
                        method: 'Runtime.executionContextCreated',
                        params: {
                            context: {
                                id: 1,
                                name: 'top',
                                url: 'vscode-file://vscode-app/Applications/Antigravity.app/Contents/Resources/app/out/vs/code/electron-browser/workbench/workbench.html',
                                origin: 'vscode-file://vscode-app',
                            },
                        },
                    }));
                    ws.send(JSON.stringify({ id: req.id, result: {} }));
                    return;
                }

                if (req.method === 'Network.enable') {
                    ws.send(JSON.stringify({ id: req.id, result: {} }));
                }
            });
        });

        mockHttpServer.listen(testPort, done);
    };

    beforeAll((done) => {
        setupMockServerWithoutCascadePanel(done);
    });

    afterAll((done) => {
        mockWss.close(() => {
            mockHttpServer.close(done);
        });
    });

    beforeEach(() => {
        service = new CdpService({ portsToScan: [testPort], maxReconnectAttempts: 0 });
    });

    afterEach(async () => {
        await service.disconnect();
    });

    it('getPrimaryContextId returns a non-null context even without cascade-panel', async () => {
        await service.connect();
        await new Promise(r => setTimeout(r, 100)); // let context events propagate

        const contextId = service.getPrimaryContextId();
        expect(contextId).not.toBeNull();
        expect(contextId).toBe(1); // workbench context
    });

    it('waitForCascadePanelReady returns true (compatibility mode) when no cascade-panel context exists', async () => {
        await service.connect();
        await new Promise(r => setTimeout(r, 100));

        // Use a short timeout so the test doesn't block for 10 seconds
        const result = await service.waitForCascadePanelReady(300, 50);
        expect(result).toBe(true); // should return true via compatibility fallback
    });

    it('waitForCascadePanelReady returns false when no contexts exist at all', async () => {
        // Do NOT connect — contexts array stays empty
        const result = await service.waitForCascadePanelReady(200, 50);
        expect(result).toBe(false);
    });
});
