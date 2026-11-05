import * as http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { CdpService } from '../../src/services/cdpService';

describe('CdpService - Antigravity out-of-process agent frames', () => {
    let server: http.Server;
    let wss: WebSocketServer;
    let socket: WebSocket;
    let port: number;
    let service: CdpService;
    let requests: any[];

    beforeAll(async () => {
        server = http.createServer((_req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify([{
                type: 'page', title: 'Test - Antigravity IDE',
                url: 'vscode-file://vscode-app/workbench.html',
                webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/test`,
            }]));
        });
        wss = new WebSocketServer({ server });
        wss.on('connection', ws => {
            socket = ws;
            ws.on('message', raw => {
                const request = JSON.parse(raw.toString());
                requests.push(request);
                if (request.method === 'Runtime.enable') {
                    ws.send(JSON.stringify({
                        method: 'Runtime.executionContextCreated',
                        ...(request.sessionId ? { sessionId: request.sessionId } : {}),
                        params: { context: {
                            id: 1, name: '',
                            origin: request.sessionId ? 'http://127.0.0.1:5049' : 'vscode-file://vscode-app',
                        } },
                    }));
                }
                if (request.method === 'Target.setAutoAttach' && !request.sessionId) {
                    ws.send(JSON.stringify({
                        method: 'Target.attachedToTarget',
                        params: {
                            sessionId: 'agent-session',
                            targetInfo: {
                                targetId: 'agent-frame', type: 'iframe',
                                url: 'http://127.0.0.1:5049/?extensionView=true',
                            },
                        },
                    }));
                }
                ws.send(JSON.stringify({
                    id: request.id,
                    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
                    result: request.method === 'Runtime.evaluate'
                        ? { result: { value: { ok: true } } } : {},
                }));
            });
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as import('net').AddressInfo).port;
    });

    beforeEach(async () => {
        requests = [];
        service = new CdpService({ portsToScan: [port], maxReconnectAttempts: 0 });
        await service.connect();
    });

    afterEach(async () => { await service.disconnect(); });
    afterAll(async () => {
        for (const client of wss.clients) client.terminate();
        await new Promise<void>(resolve => wss.close(() => server.close(() => resolve())));
    });

    /** Deliver a root or flattened-frame event and wait until the service has processed it. */
    async function emitEvent(method: string, params: any, sessionId?: string): Promise<void> {
        const observed = new Promise<void>(resolve => { service.once(method, () => resolve()); });
        socket.send(JSON.stringify({ method, params, ...(sessionId ? { sessionId } : {}) }));
        await observed;
    }

    it('routes colliding execution context IDs to the correct flattened session', async () => {
        const agentId = service.getPrimaryContextId()!;
        expect(agentId).not.toBe(1);
        expect(service.getContexts()).toHaveLength(2);
        expect(await service.waitForCascadePanelReady(100)).toBe(true);
        const params = { expression: '1', contextId: agentId, returnByValue: true };
        await service.call('Runtime.evaluate', params);
        expect(requests.at(-1)).toMatchObject({
            method: 'Runtime.evaluate', sessionId: 'agent-session', params: { contextId: 1 },
        });
        expect(params.contextId).toBe(agentId);
        await service.call('Runtime.evaluate', { expression: '1', contextId: 1 });
        expect(requests.at(-1).sessionId).toBeUndefined();
    });

    it('focuses the agent before any editor textbox in the workbench', async () => {
        const result = await service.injectMessage('connection test');
        expect(result).toMatchObject({ ok: true, contextId: service.getPrimaryContextId() });
        const focus = requests.find(request => request.method === 'Runtime.evaluate');
        expect(focus.sessionId).toBe('agent-session');
    });

    it('destroys only the context belonging to the specified frame', async () => {
        await emitEvent('Runtime.executionContextDestroyed', { executionContextId: 1 }, 'agent-session');
        expect(service.getContexts().map(context => context.id)).toEqual([1]);
    });

    it('keeps the agent when the workbench runtime is cleared', async () => {
        const agentId = service.getPrimaryContextId();
        await emitEvent('Runtime.executionContextsCleared', {});
        expect(service.getContexts().map(context => context.id)).toEqual([agentId]);
    });

    it('removes frame contexts when their target detaches', async () => {
        await emitEvent('Target.detachedFromTarget', { sessionId: 'agent-session' });
        expect(service.getContexts().map(context => context.id)).toEqual([1]);
    });
});
