import { EventEmitter } from 'events';
import { promisify } from 'util';

const execMock = jest.fn();
(execMock as any)[promisify.custom] = (...args: any[]) => {
    return new Promise((resolve, reject) => {
        execMock(...args, (err: Error | null, stdout: string, stderr: string) => {
            if (err) {
                reject(err);
                return;
            }
            resolve({ stdout, stderr });
        });
    });
};

jest.mock('child_process', () => ({
    exec: execMock,
}));

jest.mock('https', () => ({
    request: jest.fn(),
}));

import { exec } from 'child_process';
import * as https from 'https';
import { QuotaService } from '../../src/services/quotaService';

describe('QuotaService', () => {
    const mockExec = exec as unknown as typeof execMock;
    const mockRequest = https.request as unknown as jest.Mock;
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleSpy.mockRestore();
    });

    it('returns an empty array when language_server process is not found', async () => {
        mockExec.mockImplementation((_cmd: string, cb: (err: Error, stdout: string, stderr: string) => void) => {
            cb(new Error('not found'), '', '');
            return {} as any;
        });

        const service = new QuotaService();
        const result = await service.fetchQuota();

        expect(result).toEqual([]);
        expect(mockRequest).not.toHaveBeenCalled();
    });

    it('fetches quota info and caches port discovery for the same PID/Token', async () => {
        mockExec.mockImplementation((cmd: string, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
            if (cmd.startsWith('pgrep -fl language_server')) {
                cb(null, '123 language_server --csrf_token abc-123\n', '');
                return {} as any;
            }
            if (cmd.startsWith('lsof -nP -a -iTCP -sTCP:LISTEN -p 123')) {
                cb(null, 'language_server 123 user 10u IPv4 0x0 0t0 TCP *:4444 (LISTEN)\n', '');
                return {} as any;
            }
            cb(new Error(`unexpected command: ${cmd}`), '', '');
            return {} as any;
        });

        mockRequest.mockImplementation((options: any, cb: (res: EventEmitter & { statusCode?: number }) => void) => {
            const req = new EventEmitter() as EventEmitter & {
                write: jest.Mock;
                end: jest.Mock;
                destroy: jest.Mock;
            };

            req.write = jest.fn();
            req.destroy = jest.fn();
            req.end = jest.fn(() => {
                const res = new EventEmitter() as EventEmitter & { statusCode?: number };
                res.statusCode = 200;
                cb(res);
                res.emit('data', JSON.stringify({
                    userStatus: {
                        cascadeModelConfigData: {
                            clientModelConfigs: [
                                {
                                    label: 'Gemini',
                                    model: 'gemini-pro',
                                    quotaInfo: {
                                        remainingFraction: 0.6,
                                        resetTime: '2026-02-23T12:00:00.000Z',
                                    },
                                },
                            ],
                        },
                    },
                }));
                res.emit('end');
            });
            return req;
        });

        const service = new QuotaService();

        const first = await service.fetchQuota();
        const second = await service.fetchQuota();

        expect(first).toHaveLength(1);
        expect(first[0].label).toBe('Gemini');
        expect(second).toHaveLength(1);

        const executedCommands = mockExec.mock.calls.map((call) => call[0] as string);
        const lsofCalls = executedCommands.filter((cmd) => cmd.startsWith('lsof -nP -a -iTCP -sTCP:LISTEN -p 123'));
        expect(lsofCalls).toHaveLength(1);
        expect(mockRequest).toHaveBeenCalledTimes(2);
        expect(mockRequest.mock.calls[0][0].port).toBe(4444);
        expect(mockRequest.mock.calls[1][0].port).toBe(4444);
    });
});
