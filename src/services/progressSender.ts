import { Message } from 'discord.js';

export interface ProgressSenderOptions {
    message: Message;
    throttleMs?: number;
    maxLength?: number;
}

export class ProgressSender {
    private throttleMs: number;
    private maxLength: number;

    private buffer: string = '';
    private timer: NodeJS.Timeout | null = null;

    private activeMessage: Message;
    private currentContent: string = '';

    constructor(options: ProgressSenderOptions) {
        this.activeMessage = options.message;
        this.throttleMs = options.throttleMs ?? 3000;
        this.maxLength = options.maxLength ?? 4000;
    }

    public append(text: string) {
        this.buffer += text;
        if (!this.timer) {
            this.timer = setTimeout(() => {
                this.emit();
            }, this.throttleMs);
        }
    }

    public forceEmit() {
        this.emit();
    }

    private emit() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        if (!this.buffer) return;

        const newContentLength = this.currentContent.length + this.buffer.length;

        if (newContentLength > this.maxLength) {
            const overflowText = this.buffer;
            this.buffer = '';

            this.activeMessage.reply({ content: `\`\`\`\n${overflowText}\n\`\`\`` })
                .then((newMsg) => {
                    this.activeMessage = newMsg;
                    this.currentContent = `\`\`\`\n${overflowText}\n\`\`\``;
                })
                .catch(() => { });

        } else {
            this.currentContent += this.buffer;
            const text = this.currentContent;
            this.buffer = '';

            this.activeMessage.edit({ content: `\`\`\`\n${text}\n\`\`\`` }).catch(() => { });
        }
    }
}
