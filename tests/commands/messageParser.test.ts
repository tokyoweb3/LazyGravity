import { parseMessageContent } from '../../src/commands/messageParser';

describe('Message Parser', () => {
    it('correctly identifies plain instructions (just text)', () => {
        const result = parseMessageContent('こんにちは、システムを再起動してください。');
        expect(result.isCommand).toBe(false);
        expect(result.text).toBe('こんにちは、システムを再起動してください。');
    });

    it('correctly identifies a command starting with / and its arguments', () => {
        const result = parseMessageContent('/mode gpt-4');
        expect(result.isCommand).toBe(true);
        expect(result.commandName).toBe('mode');
        expect(result.args).toEqual(['gpt-4']);
    });

    it('removes double quotes from command arguments with multiple parameters', () => {
        const result = parseMessageContent('/template add "朝会" "おはよう"');
        expect(result.isCommand).toBe(true);
        expect(result.commandName).toBe('template');
        expect(result.args).toEqual(['add', '朝会', 'おはよう']);
    });

    it('correctly parses arguments without double quotes', () => {
        const result = parseMessageContent('/template PR作成');
        expect(result.isCommand).toBe(true);
        expect(result.commandName).toBe('template');
        expect(result.args).toEqual(['PR作成']);
    });

    it('correctly identifies commands while ignoring surrounding whitespace', () => {
        const result = parseMessageContent('  /stop  ');
        expect(result.isCommand).toBe(true);
        expect(result.commandName).toBe('stop');
        expect(result.args).toEqual([]);
    });

    it('treats a lone / as plain text', () => {
        const result = parseMessageContent('/');
        expect(result.isCommand).toBe(false);
        expect(result.text).toBe('/');
    });
});
