/**
 * Dispatcher for routing prompting requests to the IDE target.
 */

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

/**
 * Options package configuring prompt dispatch logic.
 */
export interface PromptDispatchOptions {
    /** Target chat session manager. */
    chatSessionService: ChatSessionService;
    /** Chat session SQLite database repository. */
    chatSessionRepo: ChatSessionRepository;
    /** Channel mapping and UI updater service. */
    channelManager: ChannelManager;
    /** Session/channel title generator service. */
    titleGenerator: TitleGeneratorService;
    /** Optional user preferences database repository. */
    userPrefRepo?: UserPreferenceRepository;
    /** Text/HTML rendering extraction mode preference. */
    extractionMode?: import('../utils/config').ExtractionMode;
    /** Optional service managing workspace artifacts. */
    artifactService?: ArtifactService;
    /** Optional callback invoked when response generation completely finishes. */
    onFullCompletion?: () => void;
    /** Optional callback receiving the created response monitor controller. */
    onMonitorCreated?: (monitor: { stop: () => Promise<void> }) => void;
    /** Max time in milliseconds to wait for a reply segment. */
    responseTimeoutMs?: number;
    /** True if we should only resume checking/polling without sending a new text prompt. */
    resumeOnly?: boolean;
}

/**
 * Encapsulates the request details for dispatching a prompt.
 */
export interface PromptDispatchRequest {
    /** The source Discord message triggering the prompt. */
    message: Message;
    /** Raw prompt text content. */
    prompt: string;
    /** Active CDP connection instance. */
    cdp: CdpService;
    /** Mapped image attachments sent by the user. */
    inboundImages?: InboundImageAttachment[];
    /** Dispatcher options. */
    options?: PromptDispatchOptions;
}

/**
 * Dependencies injected into the PromptDispatcher class.
 */
export interface PromptDispatcherDeps {
    /** Channel CDP bridge controller. */
    bridge: CdpBridge;
    /** Core mode state controller. */
    modeService: ModeService;
    /** Model selection configuration service. */
    modelService: ModelService;
    /** Core implementation executor function. */
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
    /** Active stream response monitors mapped by Discord/Telegram channel ID. */
    private readonly activeMonitors = new Map<string, { stop: () => Promise<void> }>();

    /**
     * Initializes the PromptDispatcher.
     * @param deps Injected services and action implementation dependencies.
     */
    constructor(private readonly deps: PromptDispatcherDeps) { }

    /**
     * Submits a new prompt message and starts active monitoring.
     * @param req Prompt parameters.
     */
    async send(req: PromptDispatchRequest): Promise<void> {
        await this._dispatch(req, req.options);
    }

    /**
     * Resumes checking progress of a previously active query.
     * @param req Prompt parameters.
     */
    async resume(req: PromptDispatchRequest): Promise<void> {
        await this._dispatch(req, { ...req.options, resumeOnly: true } as PromptDispatchOptions);
    }

    /**
     * Internal implementation of the dispatch action sequence.
     * Aborts prior active monitors on the channel before sending the command.
     * @param req Prompt request.
     * @param options Execution options.
     */
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
