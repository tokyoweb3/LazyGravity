import { CdpService } from '../../src/services/cdpService';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

/**
 * Step 5: メッセージ注入 (Message Injection) TDDテスト
 *
 * テスト方針:
 *   - CdpService の injectMessage() メソッドをテスト対象とする
 *   - モックWebSocketサーバーが Runtime.evaluate の呼び出しを受け取り、
 *     注入結果（成功/失敗）を返すことで、ロジックを検証する
 *   - 複数コンテキストが存在する場合に cascade-panel を優先するかを検証する
 */

describe('CdpService - メッセージ注入 (Step 5)', () => {
    let service: CdpService;
    let mockHttpServer: http.Server;
    let mockWss: WebSocketServer;
    let serverSocket: WebSocket | null = null;
    const testPort = 19223;
    const fakeWsUrl = `ws://127.0.0.1:${testPort}/devtools/page/test-id`;

    // 各テストで送受信したメッセージを格納
    let receivedMessages: any[] = [];
    let evaluateResponder: ((req: any) => { ok: boolean; method?: string; error?: string }) | null = null;

    // モックコンテキスト設定
    const mockContexts = [
        { id: 1, name: 'top', url: 'file:///workbench/index.html' },           // 優先度低
        { id: 2, name: 'cascade', url: 'file:///workbench/cascade-panel.html' }, // 優先度高
        { id: 3, name: 'Extension', url: 'file:///workbench/extension.html' },  // 中間
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
                    // コンテキスト情報を送信
                    for (const ctx of mockContexts) {
                        ws.send(JSON.stringify({
                            method: 'Runtime.executionContextCreated',
                            params: { context: ctx }
                        }));
                    }
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

    // ─────────────────────────────────────────────────────
    // テスト 1: 成功ケース (cascade-panel コンテキストで挿入成功)
    // ─────────────────────────────────────────────────────
    it('cascade-panel コンテキストでメッセージ注入に成功すること', async () => {
        await service.connect();
        await new Promise(r => setTimeout(r, 100)); // コンテキスト受信待機

        evaluateResponder = (req) => {
            const contextId = req.params.contextId;
            if (contextId === 2) return { ok: true, method: 'focus' };
            return { ok: false, error: 'No editor found' };
        };

        const result = await service.injectMessage('テストメッセージ');
        expect(result.ok).toBe(true);
        expect(result.contextId).toBe(2); // cascade-panel が選ばれること
        expect(result.method).toBe('enter');
    });

    // ─────────────────────────────────────────────────────
    // テスト 2: フォールバックケース (cascade-panel が失敗→他コンテキストで成功)
    // ─────────────────────────────────────────────────────
    it('cascade-panel が失敗した場合、他コンテキストにフォールバックして成功すること', async () => {
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

    // ─────────────────────────────────────────────────────
    // テスト 3: 全コンテキスト失敗ケース
    // ─────────────────────────────────────────────────────
    it('全コンテキストで失敗した場合 ok:false を返すこと', async () => {
        await service.connect();
        await new Promise(r => setTimeout(r, 100));

        evaluateResponder = () => ({ ok: false, error: 'No editor found' });

        const result = await service.injectMessage('失敗するメッセージ');
        expect(result.ok).toBe(false);
        expect(result.error).toBeDefined();
    });

    // ─────────────────────────────────────────────────────
    // テスト 4: inject 時に送信されるスクリプトが正しい内容を含んでいること
    // ─────────────────────────────────────────────────────
    it('injectMessage が Runtime.evaluate を正しいパラメータで呼び出すこと', async () => {
        await service.connect();
        await new Promise(r => setTimeout(r, 100));
        receivedMessages = []; // リセット

        const targetText = '注入テキスト<script>alert("xss")</script>';
        evaluateResponder = (req) => {
            const contextId = req.params.contextId;
            if (contextId === 2) return { ok: true, method: 'focus' };
            return { ok: false, error: 'No editor found' };
        };

        await service.injectMessage(targetText);

        // フォーカス用の Runtime.evaluate が呼ばれていること
        const evaluateCalls = receivedMessages.filter(m => m.method === 'Runtime.evaluate');
        expect(evaluateCalls.length).toBeGreaterThan(0);

        // focusScript を実行していること
        const firstCall = evaluateCalls[0];
        expect(firstCall.params.expression).toContain('editor.focus()');
        expect(firstCall.params.returnByValue).toBe(true);

        // テキストは Input.insertText で送信されること
        const insertTextCalls = receivedMessages.filter(m => m.method === 'Input.insertText');
        expect(insertTextCalls).toHaveLength(1);
        expect(insertTextCalls[0].params.text).toBe(targetText);

        // Enter キー送信（down/up）が呼ばれること
        const keyCalls = receivedMessages.filter(m => m.method === 'Input.dispatchKeyEvent');
        expect(keyCalls).toHaveLength(2);
        expect(keyCalls[0].params.type).toBe('keyDown');
        expect(keyCalls[1].params.type).toBe('keyUp');
    });

    // ─────────────────────────────────────────────────────
    // テスト 5: 未接続時に呼び出すと例外を投げること
    // ─────────────────────────────────────────────────────
    it('未接続状態でinjectMessageを呼ぶとエラーをスローすること', async () => {
        // 接続せずに呼ぶ
        await expect(service.injectMessage('test')).rejects.toThrow();
    });
});
