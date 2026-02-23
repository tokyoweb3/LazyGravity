import { Message } from 'discord.js';

import { ChatSessionRepository } from '../database/chatSessionRepository';
import { CdpBridge } from './cdpBridgeManager';
import { CdpService } from './cdpService';
import { ChannelManager } from './channelManager';
import { ChatSessionService } from './chatSessionService';
import { ModeService } from './modeService';
import { ModelService } from './modelService';
import { TitleGeneratorService } from './titleGeneratorService';
import { InboundImageAttachment } from '../utils/imageHandler';

export interface PromptDispatchOptions {
    chatSessionService: ChatSessionService;
    chatSessionRepo: ChatSessionRepository;
    channelManager: ChannelManager;
    titleGenerator: TitleGeneratorService;
}

export interface PromptDispatchRequest {
    message: Message;
    prompt: string;
    cdp: CdpService;
    inboundImages?: InboundImageAttachment[];
    options?: PromptDispatchOptions;
}

export interface PromptDispatcherDeps {
    bridge: CdpBridge;
    modeService: ModeService;
    modelService: ModelService;
    sendPromptImpl: (
        bridge: CdpBridge,
        message: Message,
        prompt: string,
        cdp: CdpService,
        modeService: ModeService,
        modelService: ModelService,
        inboundImages?: InboundImageAttachment[],
        options?: PromptDispatchOptions,
    ) => Promise<void>;
}

/**
 * 既存のsendPromptToAntigravityを呼び出すディスパッチャー。
 * 呼び出し側の依存注入を統一し、イベントハンドラ側を単純化する。
 */
export class PromptDispatcher {
    constructor(private readonly deps: PromptDispatcherDeps) { }

    async send(req: PromptDispatchRequest): Promise<void> {
        await this.deps.sendPromptImpl(
            this.deps.bridge,
            req.message,
            req.prompt,
            req.cdp,
            this.deps.modeService,
            this.deps.modelService,
            req.inboundImages ?? [],
            req.options,
        );
    }
}
