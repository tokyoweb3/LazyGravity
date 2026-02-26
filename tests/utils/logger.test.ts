import { createLogger, COLORS } from '../../src/utils/logger';
import type { LogLevel, LogFileTransport } from '../../src/utils/logger';

describe('createLogger', () => {
    let consoleSpy: {
        info: jest.SpyInstance;
        warn: jest.SpyInstance;
        error: jest.SpyInstance;
        debug: jest.SpyInstance;
    };

    beforeEach(() => {
        consoleSpy = {
            info: jest.spyOn(console, 'info').mockImplementation(),
            warn: jest.spyOn(console, 'warn').mockImplementation(),
            error: jest.spyOn(console, 'error').mockImplementation(),
            debug: jest.spyOn(console, 'debug').mockImplementation(),
        };
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('default level (info)', () => {
        it('outputs info, warn, error but not debug', () => {
            const log = createLogger('info');

            log.info('info message');
            log.warn('warn message');
            log.error('error message');
            log.debug('debug message');

            expect(consoleSpy.info).toHaveBeenCalledTimes(1);
            expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
            expect(consoleSpy.error).toHaveBeenCalledTimes(1);
            expect(consoleSpy.debug).not.toHaveBeenCalled();
        });
    });

    describe('debug level', () => {
        it('outputs all log levels including debug', () => {
            const log = createLogger('debug');

            log.debug('debug message');
            log.info('info message');
            log.warn('warn message');
            log.error('error message');

            expect(consoleSpy.debug).toHaveBeenCalledTimes(1);
            expect(consoleSpy.info).toHaveBeenCalledTimes(1);
            expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
            expect(consoleSpy.error).toHaveBeenCalledTimes(1);
        });
    });

    describe('warn level', () => {
        it('outputs only warn and error', () => {
            const log = createLogger('warn');

            log.debug('debug message');
            log.info('info message');
            log.warn('warn message');
            log.error('error message');

            expect(consoleSpy.debug).not.toHaveBeenCalled();
            expect(consoleSpy.info).not.toHaveBeenCalled();
            expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
            expect(consoleSpy.error).toHaveBeenCalledTimes(1);
        });
    });

    describe('error level', () => {
        it('outputs only error', () => {
            const log = createLogger('error');

            log.debug('debug message');
            log.info('info message');
            log.warn('warn message');
            log.error('error message');

            expect(consoleSpy.debug).not.toHaveBeenCalled();
            expect(consoleSpy.info).not.toHaveBeenCalled();
            expect(consoleSpy.warn).not.toHaveBeenCalled();
            expect(consoleSpy.error).toHaveBeenCalledTimes(1);
        });
    });

    describe('none level', () => {
        it('suppresses all output', () => {
            const log = createLogger('none');

            log.debug('debug message');
            log.info('info message');
            log.warn('warn message');
            log.error('error message');
            log.phase('phase message');
            log.done('done message');
            log.divider('section');

            expect(consoleSpy.debug).not.toHaveBeenCalled();
            expect(consoleSpy.info).not.toHaveBeenCalled();
            expect(consoleSpy.warn).not.toHaveBeenCalled();
            expect(consoleSpy.error).not.toHaveBeenCalled();
        });
    });

    describe('setLogLevel', () => {
        it('changes the log level at runtime', () => {
            const log = createLogger('info');

            log.debug('should not appear');
            expect(consoleSpy.debug).not.toHaveBeenCalled();

            log.setLogLevel('debug');

            log.debug('should appear');
            expect(consoleSpy.debug).toHaveBeenCalledTimes(1);
        });

        it('can escalate from debug to error', () => {
            const log = createLogger('debug');

            log.info('should appear');
            expect(consoleSpy.info).toHaveBeenCalledTimes(1);

            log.setLogLevel('error');

            log.info('should not appear');
            expect(consoleSpy.info).toHaveBeenCalledTimes(1); // still 1
        });
    });

    describe('getLogLevel', () => {
        it('returns the current log level', () => {
            const log = createLogger('warn');
            expect(log.getLogLevel()).toBe('warn');

            log.setLogLevel('debug');
            expect(log.getLogLevel()).toBe('debug');
        });
    });

    describe('phase, done, divider (info-level helpers)', () => {
        it('phase outputs at info level', () => {
            const log = createLogger('info');
            log.phase('starting phase');
            expect(consoleSpy.info).toHaveBeenCalledTimes(1);
        });

        it('phase is suppressed at warn level', () => {
            const log = createLogger('warn');
            log.phase('starting phase');
            expect(consoleSpy.info).not.toHaveBeenCalled();
        });

        it('done outputs at info level', () => {
            const log = createLogger('info');
            log.done('completed');
            expect(consoleSpy.info).toHaveBeenCalledTimes(1);
        });

        it('done is suppressed at warn level', () => {
            const log = createLogger('warn');
            log.done('completed');
            expect(consoleSpy.info).not.toHaveBeenCalled();
        });

        it('divider with label outputs at info level', () => {
            const log = createLogger('info');
            log.divider('Section');
            expect(consoleSpy.info).toHaveBeenCalledTimes(1);
        });

        it('divider without label outputs at info level', () => {
            const log = createLogger('info');
            log.divider();
            expect(consoleSpy.info).toHaveBeenCalledTimes(1);
        });

        it('divider is suppressed at error level', () => {
            const log = createLogger('error');
            log.divider('Section');
            expect(consoleSpy.info).not.toHaveBeenCalled();
        });
    });

    describe('console output format', () => {
        it('info includes [INFO] tag with cyan color', () => {
            const log = createLogger('info');
            log.info('test message');

            const output = consoleSpy.info.mock.calls[0][0] as string;
            expect(output).toContain('[INFO]');
            expect(output).toContain(COLORS.cyan);
        });

        it('warn includes [WARN] tag with yellow color', () => {
            const log = createLogger('info');
            log.warn('test message');

            const output = consoleSpy.warn.mock.calls[0][0] as string;
            expect(output).toContain('[WARN]');
            expect(output).toContain(COLORS.yellow);
        });

        it('error includes [ERROR] tag with red color', () => {
            const log = createLogger('info');
            log.error('test message');

            const output = consoleSpy.error.mock.calls[0][0] as string;
            expect(output).toContain('[ERROR]');
            expect(output).toContain(COLORS.red);
        });

        it('debug includes [DEBUG] tag with dim color', () => {
            const log = createLogger('debug');
            log.debug('test message');

            const output = consoleSpy.debug.mock.calls[0][0] as string;
            expect(output).toContain('[DEBUG]');
            expect(output).toContain(COLORS.dim);
        });

        it('phase includes [PHASE] tag with magenta color', () => {
            const log = createLogger('info');
            log.phase('test message');

            const output = consoleSpy.info.mock.calls[0][0] as string;
            expect(output).toContain('[PHASE]');
            expect(output).toContain(COLORS.magenta);
        });

        it('done includes [DONE] tag with green color', () => {
            const log = createLogger('info');
            log.done('test message');

            const output = consoleSpy.info.mock.calls[0][0] as string;
            expect(output).toContain('[DONE]');
            expect(output).toContain(COLORS.green);
        });
    });

    describe('enableFileLogging', () => {
        it('writes to file transport when enabled', () => {
            const log = createLogger('info');
            const transport: LogFileTransport = {
                write: jest.fn(),
            };

            log.enableFileLogging(transport);
            log.info('file message');

            expect(transport.write).toHaveBeenCalledTimes(1);
            expect(transport.write).toHaveBeenCalledWith(
                'INFO',
                expect.any(String),
                'file message',
            );
        });

        it('writes all levels to file regardless of console log level', () => {
            const log = createLogger('error');
            const transport: LogFileTransport = {
                write: jest.fn(),
            };

            log.enableFileLogging(transport);
            log.debug('debug msg');
            log.info('info msg');
            log.warn('warn msg');
            log.error('error msg');

            // File transport receives all messages regardless of console level
            expect(transport.write).toHaveBeenCalledTimes(4);
        });

        it('strips ANSI color codes in file output', () => {
            const log = createLogger('info');
            const transport: LogFileTransport = {
                write: jest.fn(),
            };

            log.enableFileLogging(transport);
            log.info(`${COLORS.red}colored text${COLORS.reset}`);

            const writtenMessage = (transport.write as jest.Mock).mock.calls[0][2];
            expect(writtenMessage).toBe('colored text');
            expect(writtenMessage).not.toContain('\x1b[');
        });

        it('does not write to file when transport is not enabled', () => {
            const log = createLogger('info');
            // No transport enabled - should not throw
            expect(() => log.info('no transport')).not.toThrow();
        });
    });

    describe('createLogger default', () => {
        it('defaults to info level when no argument provided', () => {
            const log = createLogger();
            expect(log.getLogLevel()).toBe('info');
        });
    });
});
