import { Client, Events } from 'discord.js';
import { startBot } from '../../src/bot';
import { createSerialTaskQueueForTest } from '../../src/bot';
import { shouldDelayFinalizationForActiveGeneration } from '../../src/bot';

jest.mock('discord.js', () => {
    return {
        Client: jest.fn().mockImplementation(() => {
            return {
                once: jest.fn(),
                on: jest.fn(),
                login: jest.fn().mockResolvedValue('test_token'),
                guilds: { cache: new Map() },
            };
        }),
        GatewayIntentBits: {
            Guilds: 1,
            GuildMessages: 2,
            MessageContent: 4,
        },
        Events: {
            ClientReady: 'ready',
            MessageCreate: 'messageCreate',
            InteractionCreate: 'interactionCreate',
        },
        SlashCommandBuilder: jest.fn().mockImplementation(() => {
            const builder: any = {};
            builder.setName = jest.fn().mockReturnValue(builder);
            builder.setDescription = jest.fn().mockReturnValue(builder);
            builder.addStringOption = jest.fn().mockImplementation((fn) => {
                const option: any = {};
                option.setName = jest.fn().mockReturnValue(option);
                option.setDescription = jest.fn().mockReturnValue(option);
                option.setRequired = jest.fn().mockReturnValue(option);
                option.addChoices = jest.fn().mockReturnValue(option);
                fn(option);
                return builder;
            });
            builder.addSubcommand = jest.fn().mockImplementation((fn) => {
                const sub: any = {};
                sub.setName = jest.fn().mockReturnValue(sub);
                sub.setDescription = jest.fn().mockReturnValue(sub);
                sub.addStringOption = jest.fn().mockImplementation((optFn: any) => {
                    const opt: any = {};
                    opt.setName = jest.fn().mockReturnValue(opt);
                    opt.setDescription = jest.fn().mockReturnValue(opt);
                    opt.setRequired = jest.fn().mockReturnValue(opt);
                    opt.addChoices = jest.fn().mockReturnValue(opt);
                    optFn(opt);
                    return sub;
                });
                fn(sub);
                return builder;
            });
            builder.addIntegerOption = jest.fn().mockImplementation((fn) => {
                const option: any = {};
                option.setName = jest.fn().mockReturnValue(option);
                option.setDescription = jest.fn().mockReturnValue(option);
                option.setRequired = jest.fn().mockReturnValue(option);
                option.setMinValue = jest.fn().mockReturnValue(option);
                option.setMaxValue = jest.fn().mockReturnValue(option);
                fn(option);
                return builder;
            });
            builder.toJSON = jest.fn().mockReturnValue({});
            return builder;
        }),
        REST: jest.fn().mockImplementation(() => ({
            setToken: jest.fn().mockReturnThis(),
            put: jest.fn().mockResolvedValue(undefined),
        })),
        Routes: {
            applicationCommands: jest.fn().mockReturnValue('/commands'),
            applicationGuildCommands: jest.fn().mockReturnValue('/guild-commands'),
        },
        AttachmentBuilder: jest.fn(),
        ButtonBuilder: jest.fn().mockImplementation(() => ({
            setCustomId: jest.fn().mockReturnThis(),
            setLabel: jest.fn().mockReturnThis(),
            setStyle: jest.fn().mockReturnThis(),
        })),
        ButtonStyle: { Success: 1, Danger: 4, Primary: 3, Secondary: 2 },
        ActionRowBuilder: jest.fn().mockImplementation(() => ({
            addComponents: jest.fn().mockReturnThis(),
            components: [],
        })),
        EmbedBuilder: jest.fn().mockImplementation(() => ({
            setTitle: jest.fn().mockReturnThis(),
            setDescription: jest.fn().mockReturnThis(),
            setColor: jest.fn().mockReturnThis(),
            addFields: jest.fn().mockReturnThis(),
            setTimestamp: jest.fn().mockReturnThis(),
            setFooter: jest.fn().mockReturnThis(),
        })),
        StringSelectMenuBuilder: jest.fn().mockImplementation(() => ({
            setCustomId: jest.fn().mockReturnThis(),
            setPlaceholder: jest.fn().mockReturnThis(),
            addOptions: jest.fn().mockReturnThis(),
        })),
        MessageFlags: { Ephemeral: 1 << 6 },
        Message: jest.fn(),
        ChatInputCommandInteraction: jest.fn(),
        Interaction: jest.fn(),
    };
});

jest.mock('../../src/utils/config', () => ({
    loadConfig: jest.fn().mockReturnValue({
        discordToken: 'test_token',
        clientId: 'test_client_id',
        guildId: 'test_guild_id',
        allowedUserIds: ['123'],
        workspaceBaseDir: '/workspace',
    }),
    resolveResponseDeliveryMode: jest.fn().mockReturnValue('stream'),
}));

jest.mock('better-sqlite3', () => {
    return jest.fn().mockImplementation(() => {
        return {
            exec: jest.fn(),
            prepare: jest.fn().mockReturnValue({ run: jest.fn(), get: jest.fn(), all: jest.fn() }),
            close: jest.fn(),
        };
    });
});

jest.mock('../../src/services/cdpService', () => {
    const EventEmitter = require('events');
    return {
        CdpService: jest.fn().mockImplementation(() => {
            const emitter = new EventEmitter();
            return Object.assign(emitter, {
                connect: jest.fn().mockRejectedValue(new Error('テスト環境: CDP未接続')),
                disconnect: jest.fn().mockResolvedValue(undefined),
                discoverTarget: jest.fn().mockRejectedValue(new Error('テスト環境')),
                injectMessage: jest.fn().mockResolvedValue({ ok: false, error: 'mock' }),
                getContexts: jest.fn().mockReturnValue([]),
                call: jest.fn().mockResolvedValue({}),
                isConnected: jest.fn().mockReturnValue(false),
            });
        }),
    };
});

jest.mock('../../src/services/screenshotService', () => ({
    ScreenshotService: jest.fn().mockImplementation(() => ({
        capture: jest.fn().mockResolvedValue({ success: false, error: 'mock' }),
    })),
}));

describe('Bot Refactor Baseline', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('refactor後も起動時にMessageCreate/InteractionCreateを購読する', async () => {
        await startBot();
        const client = (Client as unknown as jest.Mock).mock.results[0].value;
        expect(client.on).toHaveBeenCalledWith(Events.MessageCreate, expect.any(Function));
        expect(client.on).toHaveBeenCalledWith(Events.InteractionCreate, expect.any(Function));
    });

    it('response/activity 更新キューは相互にブロックしないこと', async () => {
        const events: string[] = [];
        const responseQueue = createSerialTaskQueueForTest('response', 'test-trace');
        const activityQueue = createSerialTaskQueueForTest('activity', 'test-trace');

        let releaseResponseTask!: () => void;
        const responseBlocked = new Promise<void>((resolve) => {
            releaseResponseTask = resolve;
        });

        responseQueue(async () => {
            events.push('response:start');
            await responseBlocked;
            events.push('response:end');
        }, 'response-task').catch(() => { });

        await Promise.resolve();

        await activityQueue(async () => {
            events.push('activity:run');
        }, 'activity-task');

        expect(events).toContain('response:start');
        expect(events).toContain('activity:run');
        expect(events).not.toContain('response:end');

        releaseResponseTask();
        await responseQueue(async () => {
            events.push('response:after');
        }, 'response-after');

        expect(events).toContain('response:end');
    });

    it('最終テキストも進捗テキストも空で activity が直近更新されている場合は最終化を遅延すること', () => {
        const shouldDelay = shouldDelayFinalizationForActiveGeneration({
            finalText: '',
            lastProgressText: '',
            lastActivityLogText: 'Analyzing files...',
            lastActivitySignalAt: 9_900,
            now: 10_000,
            extractionSource: 'legacy-fallback',
        });

        expect(shouldDelay).toBe(true);
    });

    it('legacy-fallback の短文進捗のみで activity が継続している場合は最終化を遅延すること', () => {
        const shouldDelay = shouldDelayFinalizationForActiveGeneration({
            finalText: '',
            lastProgressText: 'Initializing the Project',
            lastActivityLogText: 'Thinking...',
            lastActivitySignalAt: 9_500,
            now: 10_000,
            extractionSource: 'legacy-fallback',
        });

        expect(shouldDelay).toBe(true);
    });

    it('activity 更新が十分古い場合は最終化を遅延しないこと', () => {
        const shouldDelay = shouldDelayFinalizationForActiveGeneration({
            finalText: '',
            lastProgressText: '',
            lastActivityLogText: 'Analyzing files...',
            lastActivitySignalAt: 1_000,
            now: 10_000,
            extractionSource: 'legacy-fallback',
        });

        expect(shouldDelay).toBe(false);
    });
});
