import { EventEmitter } from 'events';
import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import { spawn } from 'child_process';
import { openAction } from '../../src/bin/commands/open';

jest.mock('http', () => ({ get: jest.fn() }));
jest.mock('net', () => ({ createServer: jest.fn() }));
jest.mock('os', () => ({ platform: jest.fn() }));
jest.mock('child_process', () => ({ spawn: jest.fn(), execFile: jest.fn() }));

describe('open command on Windows', () => {
    let launched: boolean;
    let originalEnv: NodeJS.ProcessEnv;
    let originalPlatform: PropertyDescriptor;
    let originalExitCode: typeof process.exitCode;

    beforeEach(() => {
        launched = false;
        originalEnv = { ...process.env };
        originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
        originalExitCode = process.exitCode;
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        (os.platform as jest.Mock).mockReturnValue('win32');
        jest.spyOn(console, 'log').mockImplementation(() => {});
        process.env.ANTIGRAVITY_PATH = 'C:\\Custom IDE\\Antigravity IDE.exe';
        process.env.ELECTRON_RUN_AS_NODE = '1';
        (net.createServer as jest.Mock).mockImplementation(() => {
            const server = new EventEmitter() as any;
            server.listen = () => { process.nextTick(() => server.emit('listening')); };
            server.close = (callback: () => void) => callback();
            return server;
        });
        (http.get as jest.Mock).mockImplementation((_url: string, callback: Function) => {
            const request = new EventEmitter() as any;
            request.setTimeout = jest.fn();
            request.destroy = jest.fn();
            const response = new EventEmitter();
            callback(response);
            process.nextTick(() => {
                response.emit('data', JSON.stringify(launched ? [{ title: 'Antigravity IDE' }] : []));
                response.emit('end');
            });
            return request;
        });
        (spawn as jest.Mock).mockImplementation(() => {
            launched = true;
            const child = new EventEmitter() as any;
            child.unref = jest.fn();
            process.nextTick(() => child.emit('spawn'));
            return child;
        });
    });

    afterEach(() => {
        process.env = originalEnv;
        process.exitCode = originalExitCode;
        Object.defineProperty(process, 'platform', originalPlatform);
        jest.restoreAllMocks();
        jest.clearAllMocks();
    });

    it('uses the executable override directly and removes the Electron Node-mode variable', async () => {
        await openAction();
        expect(spawn).toHaveBeenCalledWith(
            'C:\\Custom IDE\\Antigravity IDE.exe', ['--remote-debugging-port=9222'],
            expect.objectContaining({ detached: true, windowsHide: true }),
        );
        const options = (spawn as jest.Mock).mock.calls[0][2];
        expect(options.shell).toBeUndefined();
        expect(options.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
        expect(process.env.ELECTRON_RUN_AS_NODE).toBe('1');
    });

    it('reuses an existing Antigravity debug port', async () => {
        launched = true;
        await openAction();
        expect(spawn).not.toHaveBeenCalled();
        expect(net.createServer).not.toHaveBeenCalled();
    });

    it('recognizes an existing IDE by its title when the workbench URL is generic', async () => {
        (http.get as jest.Mock).mockImplementation((_url: string, callback: Function) => {
            const request = new EventEmitter() as any;
            request.setTimeout = jest.fn();
            const response = new EventEmitter();
            callback(response);
            process.nextTick(() => {
                response.emit('data', JSON.stringify([{
                    url: 'vscode-file://vscode-app/workbench.html', title: 'Test - Antigravity IDE',
                }]));
                response.emit('end');
            });
            return request;
        });
        await openAction();
        expect(spawn).not.toHaveBeenCalled();
        expect(net.createServer).not.toHaveBeenCalled();
    });

    it('reports executable launch errors', async () => {
        (spawn as jest.Mock).mockImplementation(() => {
            const child = new EventEmitter();
            process.nextTick(() => child.emit('error', new Error('ENOENT')));
            return child;
        });
        await openAction();
        expect(process.exitCode).toBe(1);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
    });
});
