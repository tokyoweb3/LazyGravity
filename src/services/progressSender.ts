/**
 * Helper utility to throttle and send progress output logs.
 */

import { Message } from 'discord.js';
import { logger } from '../utils/logger';

/**
 * Options configuring the ProgressSender behavior.
 */
export interface ProgressSenderOptions {
    /** Target Discord message to reply to. */
    message?: Message;
    /** Direct send callback function. */
    send?: (content: string) => Promise<unknown>;
    /** Delay in milliseconds to throttle outputs. */
    throttleMs?: number;
    /** Maximum length of a single message block. */
    maxLength?: number;
    /** True to wrap output text in Markdown code blocks. */
    wrapInCodeBlock?: boolean;
}

/**
 * Class that collects streaming text/logs and sends them in throttled chunks.
 */
export class ProgressSender {
    /** Delay in milliseconds to wait before posting. */
    private throttleMs: number;
    /** Maximum length of a single message chunk. */
    private maxLength: number;
    /** Wrap logs in backticks layout. */
    private wrapInCodeBlock: boolean;

    /** Internal log string buffer. */
    private buffer: string = '';
    /** Active timeout timer. */
    private timer: NodeJS.Timeout | null = null;

    /** Handler logic for executing message deliveries. */
    private sendContent: (content: string) => Promise<unknown>;
    /** Sequential promise chain to ensure ordered delivery of message chunks. */
    private promiseChain: Promise<any> = Promise.resolve();

    /**
     * Initializes the ProgressSender instance.
     * @param options Configuration options package.
     */
    constructor(options: ProgressSenderOptions) {
        if (!options.send && !options.message) {
            throw new Error('ProgressSender requires either message or send option');
        }
        this.sendContent = options.send
            ? options.send
            : async (content: string) => options.message!.reply({ content });
        this.throttleMs = options.throttleMs ?? 3000;
        this.maxLength = options.maxLength ?? 4000;
        this.wrapInCodeBlock = options.wrapInCodeBlock ?? true;
    }

    /**
     * Appends text to the internal log buffer and starts the throttle timer if not active.
     * @param text Log text segment to append.
     */
    public append(text: string) {
        this.buffer += text;
        if (!this.timer) {
            this.timer = setTimeout(() => {
                this.emit();
            }, this.throttleMs);
        }
    }

    /**
     * Instantly flushes the accumulated buffer.
     */
    public forceEmit() {
        this.emit();
    }

    /**
     * Flushes the buffer contents to the platform client by splitting by max length.
     */
    private emit() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        if (!this.buffer) return;
        const payload = this.buffer;
        this.buffer = '';

        const chunks = this.splitByLength(payload, this.maxLength);
        for (const chunk of chunks) {
            const content = this.wrapInCodeBlock ? `\`\`\`\n${chunk}\n\`\`\`` : chunk;
            this.promiseChain = this.promiseChain
                .then(() => this.sendContent(content))
                .catch((err) => {
                    logger.error('[ProgressSender] Failed to send progress chunk:', err);
                });
        }
    }

    /**
     * Splits a large text string into chunks of max size.
     * @param text Original large string.
     * @param maxLength Split threshold block size.
     * @returns Array of chunk segments.
     */
    private splitByLength(text: string, maxLength: number): string[] {
        if (text.length <= maxLength) {
            return [text];
        }

        const result: string[] = [];
        let cursor = 0;
        while (cursor < text.length) {
            result.push(text.slice(cursor, cursor + maxLength));
            cursor += maxLength;
        }
        return result;
    }
}
