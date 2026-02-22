import { parseMessageContent } from '../../src/commands/messageParser';

describe('Message Parser', () => {
    it('プレーンな指示（ただのテキスト）を正しく判別できるか', () => {
        const result = parseMessageContent('こんにちは、システムを再起動してください。');
        expect(result.isCommand).toBe(false);
        expect(result.text).toBe('こんにちは、システムを再起動してください。');
    });

    it('/から始まるコマンドとその引数を正しく判別できるか', () => {
        const result = parseMessageContent('/mode gpt-4');
        expect(result.isCommand).toBe(true);
        expect(result.commandName).toBe('mode');
        expect(result.args).toEqual(['gpt-4']);
    });

    it('複数引数を持つコマンドのダブルクォートが除去されること', () => {
        const result = parseMessageContent('/schedule add "毎朝9時" "おはよう"');
        expect(result.isCommand).toBe(true);
        expect(result.commandName).toBe('schedule');
        expect(result.args).toEqual(['add', '毎朝9時', 'おはよう']);
    });

    it('ダブルクォートなしの引数も正しくパースされること', () => {
        const result = parseMessageContent('/templates PR作成');
        expect(result.isCommand).toBe(true);
        expect(result.commandName).toBe('templates');
        expect(result.args).toEqual(['PR作成']);
    });

    it('前後の空白を無視して正しく判別できるか', () => {
        const result = parseMessageContent('  /stop  ');
        expect(result.isCommand).toBe(true);
        expect(result.commandName).toBe('stop');
        expect(result.args).toEqual([]);
    });

    it('/だけの場合はプレーンテキストとして扱うか', () => {
        const result = parseMessageContent('/');
        expect(result.isCommand).toBe(false);
        expect(result.text).toBe('/');
    });
});
