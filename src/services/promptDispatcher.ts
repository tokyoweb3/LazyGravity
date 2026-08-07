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
import { UserPreferenceRepository } from '../database/userPreferenceRepository';

import { ArtifactService } from './artifactService';
import { logger } from '../utils/logger';

export interface PromptDispatchOptions {
    chatSessionService: ChatSessionService;
    chatSessionRepo: ChatSessionRepository;
    channelManager: ChannelManager;
    titleGenerator: TitleGeneratorService;
    userPrefRepo?: UserPreferenceRepository;
    extractionMode?: import('../utils/config').ExtractionMode;
    artifactService?: ArtifactService;
    onFullCompletion?: () => void;
    onMonitorCreated?: (monitor: { stop: () => Promise<void> }) => void;
    responseTimeoutMs?: number;
    resumeOnly?: boolean;
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
 * Dispatcher that calls the existing sendPromptToAntigravity.
 * Unifies dependency injection on the caller side and simplifies event handlers.
 */
export class PromptDispatcher {
    private readonly activeMonitors = new Map<string, { stop: () => Promise<void> }>();

    constructor(private readonly deps: PromptDispatcherDeps) { }

    async send(req: PromptDispatchRequest): Promise<void> {
        await this._dispatch(req, req.options);
    }

    async resume(req: PromptDispatchRequest): Promise<void> {
        await this._dispatch(req, { ...req.options, resumeOnly: true } as PromptDispatchOptions);
    }

    private async _dispatch(req: PromptDispatchRequest, options?: PromptDispatchOptions): Promise<void> {
        const channelId = req.message.channelId;
        const existing = this.activeMonitors.get(channelId);
        if (existing) {
            logger.info(`[PromptDispatcher] Aborting previous active monitor for channel ${channelId}`);
            await existing.stop().catch((err: any) => logger.error('[PromptDispatcher] Error stopping monitor:', err));
            this.activeMonitors.delete(channelId);
        }

        const wrappedOptions: PromptDispatchOptions = {
            ...(options || {} as any),
            onMonitorCreated: (monitor: any) => {
                this.activeMonitors.set(channelId, monitor);
                options?.onMonitorCreated?.(monitor);
            },
            onFullCompletion: () => {
                this.activeMonitors.delete(channelId);
                options?.onFullCompletion?.();
            }
        };

        await this.deps.sendPromptImpl(
            this.deps.bridge,
            req.message,
            req.prompt,
            req.cdp,
            this.deps.modeService,
            this.deps.modelService,
            req.inboundImages ?? [],
            wrappedOptions,
        );
    }
}
