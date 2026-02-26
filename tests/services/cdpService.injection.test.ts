import { CdpService } from '../../src/services/cdpService';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

/**
 * Step 5: Message Injection TDD Tests
 *
 * Test strategy:
 *   - Tests the injectMessage() method of CdpService
 *   - Mock WebSocket server receives Runtime.evaluate calls and
 *     returns injection results (success/failure) to verify logic
 *   - Verifies that cascade-panel is prioritized when multiple contexts exist
 */

describe('CdpService - Message Injection (Step 5)', () => {
    let service: CdpService;
    let mockHttpServer: http.Server;
    let mockWss: WebSocketServer;
    let serverSocket: WebSocket | null = null;
    const testPort = 19223;
    const fakeWsUrl = `ws://127.0.0.1:${testPort}/devtools/page/test-id`;

    // Store sent/received messages per test
    let receivedMessages: any[] = [];
    let evaluateResponder: ((req: any) => { ok: boolean; method?: string; error?: string }) | null = null;

    // Mock context configuration
    const mockContexts = [
        { id: 1, name: 'top', url: 'file:///workbench/index.html' },           // Low priority
        { id: 2, name: 'cascade', url: 'file:///workbench/cascade-panel.html' }, // High priority
        { id: 3, name: 'Extension', url: 'file:///workbench/extension.html' },  // Medium priority
    ];

    beforeAll((done) => {
        mockHttpServer = http.createServer((req, res) => {
            if (req.url === '/json/list') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify([
                    {
                        type: 'page',
                        title: 'Antigravity Workspace',
                        url: 'file:///workbench/index.html',
                        webSocketDebuggerUrl: fakeWsUrl
                    }
                ]));
            } else {
                res.writeHead(404);
                res.end();
            }
        });

        mockWss = new WebSocketServer({ server: mockHttpServer });

        mockWss.on('connection', (ws) => {
            serverSocket = ws;
            receivedMessages = [];
            evaluateResponder = null;

            ws.on('message', (message) => {
                const req = JSON.parse(message.toString());
                receivedMessages.push(req);

                if (req.method === 'Runtime.enable') {
                    // Send context information
                    for (const ctx of mockContexts) {
                        ws.send(JSON.stringify({
                            method: 'Runtime.executionContextCreated',
                            params: { context: ctx }
                        }));
                    }
                    ws.send(JSON.stringify({ id: req.id, result: {} }));
                    return;
                }

                if (req.method === 'Network.enable') {
                    ws.send(JSON.stringify({ id: req.id, result: {} }));
                    return;
                }

                if (req.method === 'Runtime.evaluate') {
                    const result = evaluateResponder
                        ? evaluateResponder(req)
                        : { ok: false, error: 'No responder configured' };

                    ws.send(JSON.stringify({
                        id: req.id,
                        result: { result: { value: result } }
                    }));
                    return;
                }

                if (req.method === 'Input.insertText' || req.method === 'Input.dispatchKeyEvent') {
                    ws.send(JSON.stringify({ id: req.id, result: {} }));
                }
            });
        });

        mockHttpServer.listen(testPort, done);
    });

    afterAll((done) => {
        mockWss.close(() => mockHttpServer.close(done));
    });

    beforeEach(() => {
        service = new CdpService({ portsToScan: [testPort] });
    });

    afterEach(async () => {
        await service.disconnect();
    });

    // ---------------------------------------------------------
    // Test 1: Success case (insertion succeeds in cascade-panel context)
    // ---------------------------------------------------------
    it('successfully injects a message in the cascade-panel context', async () => {
        await service.connect();
        await new Promise(r => setTimeout(r, 100)); // Wait for context reception

        evaluateResponder = (req) => {
            const contextId = req.params.contextId;
            if (contextId === 2) return { ok: true, method: 'focus' };
            return { ok: false, error: 'No editor found' };
        };

        const result = await service.injectMessage('テストメッセージ');
        expect(result.ok).toBe(true);
        expect(result.contextId).toBe(2); // cascade-panel should be selected
        expect(result.method).toBe('enter');
    });

    // ---------------------------------------------------------
    // Test 2: Fallback case (cascade-panel fails, succeeds in another context)
    // ---------------------------------------------------------
    it('falls back to another context when cascade-panel fails', async () => {
        await service.connect();
        await new Promise(r => setTimeout(r, 100));

        evaluateResponder = (req) => {
            const contextId = req.params.contextId;
            if (contextId === 3) return { ok: true, method: 'focus' };
            return { ok: false, error: 'No editor found' };
        };

        const result = await service.injectMessage('フォールバックテスト');
        expect(result.ok).toBe(true);
        expect(result.contextId).toBe(3);
    });

    // ---------------------------------------------------------
    // Test 3: All contexts fail case
    // ---------------------------------------------------------
    it('returns ok:false when all contexts fail', async () => {
        await service.connect();
        await new Promise(r => setTimeout(r, 100));

        evaluateResponder = () => ({ ok: false, error: 'No editor found' });

        const result = await service.injectMessage('失敗するメッセージ');
        expect(result.ok).toBe(false);
        expect(result.error).toBeDefined();
    });

    // ---------------------------------------------------------
    // Test 4: Verify the injected script contains correct content
    // ---------------------------------------------------------
    it('calls Runtime.evaluate with the correct parameters during injectMessage', async () => {
        await service.connect();
        await new Promise(r => setTimeout(r, 100));
        receivedMessages = []; // Reset

        const targetText = '注入テキスト<script>alert("xss")</script>';
        evaluateResponder = (req) => {
            const contextId = req.params.contextId;
            if (contextId === 2) return { ok: true, method: 'focus' };
            return { ok: false, error: 'No editor found' };
        };

        await service.injectMessage(targetText);

        // Verify that Runtime.evaluate for focus was called
        const evaluateCalls = receivedMessages.filter(m => m.method === 'Runtime.evaluate');
        expect(evaluateCalls.length).toBeGreaterThan(0);

        // Verify that the focusScript was executed
        const firstCall = evaluateCalls[0];
        expect(firstCall.params.expression).toContain('editor.focus()');
        expect(firstCall.params.returnByValue).toBe(true);

        // Verify that text is sent via Input.insertText
        const insertTextCalls = receivedMessages.filter(m => m.method === 'Input.insertText');
        expect(insertTextCalls).toHaveLength(1);
        expect(insertTextCalls[0].params.text).toBe(targetText);

        // Verify that key events are dispatched:
        //   clearInputField: Meta+A (keyDown/keyUp) + Backspace (keyDown/keyUp) = 4 events
        //   pressEnterToSend: Enter (keyDown/keyUp) = 2 events
        const keyCalls = receivedMessages.filter(m => m.method === 'Input.dispatchKeyEvent');
        expect(keyCalls).toHaveLength(6);
        // clearInputField: Meta+A select all
        expect(keyCalls[0].params.key).toBe('a');
        expect(keyCalls[0].params.modifiers).toBe(4);
        expect(keyCalls[1].params.key).toBe('a');
        // clearInputField: Backspace delete
        expect(keyCalls[2].params.key).toBe('Backspace');
        expect(keyCalls[3].params.key).toBe('Backspace');
        // pressEnterToSend: Enter
        expect(keyCalls[4].params.key).toBe('Enter');
        expect(keyCalls[4].params.type).toBe('keyDown');
        expect(keyCalls[5].params.key).toBe('Enter');
        expect(keyCalls[5].params.type).toBe('keyUp');
    });

    // ---------------------------------------------------------
    // Test 5: Throws exception when called while not connected
    // ---------------------------------------------------------
    it('throws an error when injectMessage is called while not connected', async () => {
        // Call without connecting
        await expect(service.injectMessage('test')).rejects.toThrow();
    });
});
