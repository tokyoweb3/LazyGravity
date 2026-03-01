import { LogBuffer } from '../../src/utils/logBuffer';

describe('LogBuffer', () => {
    let buffer: LogBuffer;

    beforeEach(() => {
        buffer = new LogBuffer();
    });

    describe('append and getRecent', () => {
        it('returns empty array when no entries exist', () => {
            expect(buffer.getRecent(10)).toEqual([]);
        });

        it('stores and retrieves a single entry', () => {
            buffer.append('info', 'hello');

            const entries = buffer.getRecent(10);
            expect(entries).toHaveLength(1);
            expect(entries[0].level).toBe('info');
            expect(entries[0].message).toBe('hello');
            expect(entries[0].timestamp).toBeDefined();
        });

        it('returns entries in chronological order', () => {
            buffer.append('info', 'first');
            buffer.append('warn', 'second');
            buffer.append('error', 'third');

            const entries = buffer.getRecent(10);
            expect(entries).toHaveLength(3);
            expect(entries[0].message).toBe('first');
            expect(entries[1].message).toBe('second');
            expect(entries[2].message).toBe('third');
        });

        it('limits returned entries to requested count', () => {
            buffer.append('info', 'a');
            buffer.append('info', 'b');
            buffer.append('info', 'c');

            const entries = buffer.getRecent(2);
            expect(entries).toHaveLength(2);
            expect(entries[0].message).toBe('b');
            expect(entries[1].message).toBe('c');
        });

        it('returns all entries when count exceeds total', () => {
            buffer.append('info', 'only');

            const entries = buffer.getRecent(100);
            expect(entries).toHaveLength(1);
            expect(entries[0].message).toBe('only');
        });
    });

    describe('circular buffer eviction', () => {
        it('evicts oldest entries when exceeding max capacity (200)', () => {
            for (let i = 0; i < 210; i++) {
                buffer.append('info', `msg-${i}`);
            }

            const entries = buffer.getRecent(200);
            expect(entries).toHaveLength(200);
            expect(entries[0].message).toBe('msg-10');
            expect(entries[199].message).toBe('msg-209');
        });

        it('maintains correct order after wrap-around', () => {
            for (let i = 0; i < 205; i++) {
                buffer.append('info', `entry-${i}`);
            }

            const entries = buffer.getRecent(5);
            expect(entries).toHaveLength(5);
            expect(entries[0].message).toBe('entry-200');
            expect(entries[4].message).toBe('entry-204');
        });
    });

    describe('level filter', () => {
        it('filters entries by level', () => {
            buffer.append('info', 'info1');
            buffer.append('warn', 'warn1');
            buffer.append('error', 'error1');
            buffer.append('info', 'info2');

            const warnOnly = buffer.getRecent(10, 'warn');
            expect(warnOnly).toHaveLength(1);
            expect(warnOnly[0].message).toBe('warn1');
        });

        it('returns empty array when no entries match filter', () => {
            buffer.append('info', 'hello');
            buffer.append('info', 'world');

            expect(buffer.getRecent(10, 'error')).toEqual([]);
        });

        it('applies count limit after filtering', () => {
            buffer.append('info', 'a');
            buffer.append('error', 'b');
            buffer.append('info', 'c');
            buffer.append('info', 'd');

            const entries = buffer.getRecent(2, 'info');
            expect(entries).toHaveLength(2);
            expect(entries[0].message).toBe('c');
            expect(entries[1].message).toBe('d');
        });
    });

    describe('clear', () => {
        it('removes all entries', () => {
            buffer.append('info', 'a');
            buffer.append('info', 'b');
            buffer.clear();

            expect(buffer.getRecent(10)).toEqual([]);
        });

        it('allows new entries after clearing', () => {
            buffer.append('info', 'before');
            buffer.clear();
            buffer.append('warn', 'after');

            const entries = buffer.getRecent(10);
            expect(entries).toHaveLength(1);
            expect(entries[0].message).toBe('after');
        });
    });

    describe('ANSI stripping', () => {
        it('strips ANSI escape codes from stored messages', () => {
            buffer.append('info', '\x1b[31mred text\x1b[0m');

            const entries = buffer.getRecent(1);
            expect(entries[0].message).toBe('red text');
        });

        it('strips complex ANSI sequences', () => {
            buffer.append('info', '\x1b[2m[12:00:00]\x1b[0m \x1b[36m[INFO]\x1b[0m hello');

            const entries = buffer.getRecent(1);
            expect(entries[0].message).toBe('[12:00:00] [INFO] hello');
        });
    });

    describe('timestamp', () => {
        it('generates ISO timestamps', () => {
            buffer.append('info', 'test');

            const entries = buffer.getRecent(1);
            expect(() => new Date(entries[0].timestamp)).not.toThrow();
            expect(new Date(entries[0].timestamp).toISOString()).toBe(entries[0].timestamp);
        });
    });
});
