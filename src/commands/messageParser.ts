/**
 * Structured details of a parsed text message.
 */
export interface ParsedMessage {
    /** True if the message represents a slash/bot command. */
    isCommand: boolean;
    /** Command name, if parsed. */
    commandName?: string;
    /** Arguments array, if parsed. */
    args?: string[];
    /** Original message text, if not a command. */
    text?: string;
}

/**
 * Parses user input message text to extract potential bot command name and arguments.
 * @param content Raw input content string.
 * @returns Parsed message properties.
 */
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
