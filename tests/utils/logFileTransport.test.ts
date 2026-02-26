import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LogFileTransportImpl } from '../../src/utils/logFileTransport';

describe('LogFileTransportImpl', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-log-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('write', () => {
        it('creates log file and appends a line', () => {
            const transport = new LogFileTransportImpl(tmpDir);

            transport.write('INFO', '2025-01-15T10:30:00.000Z', 'Hello world');

            const files = fs.readdirSync(tmpDir);
            expect(files.length).toBe(1);
            expect(files[0]).toMatch(/^lazy-gravity-\d{4}-\d{2}-\d{2}\.log$/);

            const content = fs.readFileSync(
                path.join(tmpDir, files[0]),
                'utf-8',
            );
            expect(content).toBe(
                '2025-01-15T10:30:00.000Z [INFO] Hello world\n',
            );
        });

        it('appends multiple lines to the same file', () => {
            const transport = new LogFileTransportImpl(tmpDir);

            transport.write('INFO', '2025-01-15T10:30:00.000Z', 'Line 1');
            transport.write('WARN', '2025-01-15T10:30:01.000Z', 'Line 2');
            transport.write('ERROR', '2025-01-15T10:30:02.000Z', 'Line 3');

            const files = fs.readdirSync(tmpDir);
            expect(files.length).toBe(1);

            const content = fs.readFileSync(
                path.join(tmpDir, files[0]),
                'utf-8',
            );
            const lines = content.trim().split('\n');
            expect(lines.length).toBe(3);
            expect(lines[0]).toContain('[INFO]');
            expect(lines[1]).toContain('[WARN]');
            expect(lines[2]).toContain('[ERROR]');
        });

        it('creates the log directory if it does not exist', () => {
            const nestedDir = path.join(tmpDir, 'nested', 'logs');
            const transport = new LogFileTransportImpl(nestedDir);

            transport.write('INFO', '2025-01-15T10:30:00.000Z', 'test');

            expect(fs.existsSync(nestedDir)).toBe(true);
            const files = fs.readdirSync(nestedDir);
            expect(files.length).toBe(1);
        });

        it('does not throw when write fails (e.g. permission error)', () => {
            const transport = new LogFileTransportImpl(tmpDir);

            // Make dir read-only to simulate write failure
            fs.chmodSync(tmpDir, 0o444);

            expect(() =>
                transport.write('INFO', '2025-01-15T10:30:00.000Z', 'test'),
            ).not.toThrow();

            // Restore permissions for cleanup
            fs.chmodSync(tmpDir, 0o755);
        });
    });

    describe('cleanupSync', () => {
        it('removes oldest files when count exceeds maxFiles', () => {
            const transport = new LogFileTransportImpl(tmpDir);

            // Create 5 fake log files
            for (let i = 1; i <= 5; i++) {
                const fileName = `lazy-gravity-2025-01-${String(i).padStart(2, '0')}.log`;
                fs.writeFileSync(
                    path.join(tmpDir, fileName),
                    'test log line\n',
                );
            }

            transport.cleanupSync(3, 10 * 1024 * 1024);

            const remaining = fs.readdirSync(tmpDir).sort();
            expect(remaining.length).toBe(3);
            // Oldest 2 should be removed, newest 3 kept
            expect(remaining).toEqual([
                'lazy-gravity-2025-01-03.log',
                'lazy-gravity-2025-01-04.log',
                'lazy-gravity-2025-01-05.log',
            ]);
        });

        it('removes files that exceed maxSizeBytes', () => {
            const transport = new LogFileTransportImpl(tmpDir);

            // Create a small file and a large file
            fs.writeFileSync(
                path.join(tmpDir, 'lazy-gravity-2025-01-01.log'),
                'small\n',
            );
            fs.writeFileSync(
                path.join(tmpDir, 'lazy-gravity-2025-01-02.log'),
                'x'.repeat(200),
            );

            // maxSizeBytes = 100, so the 200-byte file should be removed
            transport.cleanupSync(100, 100);

            const remaining = fs.readdirSync(tmpDir);
            expect(remaining).toEqual(['lazy-gravity-2025-01-01.log']);
        });

        it('does nothing when directory does not exist', () => {
            const nonexistent = path.join(tmpDir, 'nonexistent');
            const transport = new LogFileTransportImpl(tmpDir);

            // Manually point cleanup at a nonexistent dir
            // Use cleanupSync on the transport but delete the dir first
            fs.rmSync(tmpDir, { recursive: true, force: true });

            expect(() => transport.cleanupSync()).not.toThrow();
        });

        it('ignores non-log files in the directory', () => {
            const transport = new LogFileTransportImpl(tmpDir);

            fs.writeFileSync(path.join(tmpDir, 'lazy-gravity-2025-01-01.log'), 'log1\n');
            fs.writeFileSync(path.join(tmpDir, 'other-file.txt'), 'not a log\n');
            fs.writeFileSync(path.join(tmpDir, 'lazy-gravity-2025-01-02.log'), 'log2\n');

            transport.cleanupSync(1, 10 * 1024 * 1024);

            const remaining = fs.readdirSync(tmpDir).sort();
            // Should keep 1 log file + the non-log file
            expect(remaining).toContain('other-file.txt');
            expect(remaining.filter((f) => f.endsWith('.log'))).toEqual([
                'lazy-gravity-2025-01-02.log',
            ]);
        });
    });

    describe('date rolling', () => {
        it('uses today\'s date in the filename', () => {
            const transport = new LogFileTransportImpl(tmpDir);
            transport.write('INFO', '2025-01-15T10:30:00.000Z', 'test');

            const files = fs.readdirSync(tmpDir);
            expect(files.length).toBe(1);

            const today = new Date();
            const y = today.getFullYear();
            const m = String(today.getMonth() + 1).padStart(2, '0');
            const d = String(today.getDate()).padStart(2, '0');
            const expectedName = `lazy-gravity-${y}-${m}-${d}.log`;

            expect(files[0]).toBe(expectedName);
        });
    });
});
