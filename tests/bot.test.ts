import { Client, GatewayIntentBits, Events } from 'discord.js';
import { startBot } from '../src/bot';
import { loadConfig } from '../src/utils/config';
import { getResponseDeliveryModeForTest } from '../src/bot';

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
        // スラッシュコマンド用のモック
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
        // 結線で使う追加のモック
        AttachmentBuilder: jest.fn(),
        ButtonBuilder: jest.fn().mockImplementation(() => ({
            setCustomId: jest.fn().mockReturnThis(),
            setLabel: jest.fn().mockReturnThis(),
            setStyle: jest.fn().mockReturnThis(),
        })),
        ButtonStyle: { Success: 1, Danger: 4 },
        ActionRowBuilder: jest.fn().mockImplementation(() => ({
            addComponents: jest.fn().mockReturnThis(),
        })),
        EmbedBuilder: jest.fn().mockImplementation(() => ({
            setTitle: jest.fn().mockReturnThis(),
            setDescription: jest.fn().mockReturnThis(),
            setColor: jest.fn().mockReturnThis(),
            addFields: jest.fn().mockReturnThis(),
            setTimestamp: jest.fn().mockReturnThis(),
        })),
        Message: jest.fn(),
    };
});

jest.mock('../src/utils/config', () => ({
    loadConfig: jest.fn().mockReturnValue({
        discordToken: 'test_token',
        clientId: 'test_client_id',
        guildId: 'test_guild_id',
        allowedUserIds: ['123'],
        workspaceBaseDir: '/workspace'
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

// CDPサービスのモック（実際のネットワーク接続を防ぐ）
jest.mock('../src/services/cdpService', () => {
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

jest.mock('../src/services/screenshotService', () => ({
    ScreenshotService: jest.fn().mockImplementation(() => ({
        capture: jest.fn().mockResolvedValue({ success: false, error: 'mock' }),
    })),
}));

describe('Bot Startup', () => {
    let clientInstance: any;

    beforeEach(async () => {
        jest.clearAllMocks();
        await startBot();
        clientInstance = (Client as unknown as jest.Mock).mock.results[0].value;
    });

    it('initializes the client with correct intents', () => {
        expect(Client).toHaveBeenCalledWith({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
            ]
        });
    });

    it('listens for the ready event', () => {
        expect(clientInstance.once).toHaveBeenCalledWith(Events.ClientReady, expect.any(Function));
    });

    it('listens for message creation', () => {
        expect(clientInstance.on).toHaveBeenCalledWith(Events.MessageCreate, expect.any(Function));
    });

    it('listens for interaction creation (slash commands)', () => {
        expect(clientInstance.on).toHaveBeenCalledWith(Events.InteractionCreate, expect.any(Function));
    });

    it('calls login with the token from config', () => {
        expect(clientInstance.login).toHaveBeenCalledWith('test_token');
    });

    it('final-only設定があってもレスポンス配信モードはstream固定であること', () => {
        process.env.LAZYGRAVITY_RESPONSE_DELIVERY = 'final-only';
        expect(getResponseDeliveryModeForTest()).toBe('stream');
    });
});
