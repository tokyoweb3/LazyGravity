export interface ParsedMessage {
    isCommand: boolean;
    commandName?: string;
    args?: string[];
    text?: string;
}

export function parseMessageContent(content: string): ParsedMessage {
    const trimmed = content.trim();

    if (!trimmed.startsWith('/') || trimmed === '/') {
        return {
            isCommand: false,
            text: content
        };
    }

    // '/'を取り除いて、スペース区切りで抽出。ダブルクォートで囲まれた部分は1つにまとめる
    const parts = trimmed.slice(1).match(/(?:[^\s"]+|"[^"]*")+/g) || [];

    if (parts.length === 0) {
        return {
            isCommand: false,
            text: content
        };
    }

    const commandName = parts[0];
    // ダブルクォートで囲まれた引数の前後のクォートを除去する
    const args = parts.slice(1).map((arg) => arg.replace(/^"(.*)"$/, '$1'));

    return {
        isCommand: true,
        commandName,
        args
    };
}
