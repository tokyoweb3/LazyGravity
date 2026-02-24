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

    // Strip leading '/' and split by spaces. Double-quoted segments are kept as one token
    const parts = trimmed.slice(1).match(/(?:[^\s"]+|"[^"]*")+/g) || [];

    if (parts.length === 0) {
        return {
            isCommand: false,
            text: content
        };
    }

    const commandName = parts[0];
    // Strip surrounding double quotes from arguments
    const args = parts.slice(1).map((arg) => arg.replace(/^"(.*)"$/, '$1'));

    return {
        isCommand: true,
        commandName,
        args
    };
}
