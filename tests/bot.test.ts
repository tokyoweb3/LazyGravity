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
                user: { id: 'bot-id' },
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
        MessageFlags: {
            Ephemeral: 64,
        },
        ChannelType: {
            GuildText: 0,
            GuildAnnouncement: 5,
        },
        // Mock for slash commands
        SlashCommandBuilder: jest.fn().mockImplementation(() => {
            const builder: any = {};
            builder.setName = jest.fn().mockReturnValue(builder);
            builder.setDescription = jest.fn().mockReturnValue(builder);
            builder.setDefaultMemberPermissions = jest.fn().mockReturnValue(builder);
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
                sub.addChannelOption = jest.fn().mockImplementation((optFn: any) => {
                    const opt: any = {};
                    opt.setName = jest.fn().mockReturnValue(opt);
                    opt.setDescription = jest.fn().mockReturnValue(opt);
                    opt.setRequired = jest.fn().mockReturnValue(opt);
                    opt.addChannelTypes = jest.fn().mockReturnValue(opt);
                    optFn(opt);
                    return sub;
                });
                sub.addIntegerOption = jest.fn().mockImplementation((optFn: any) => {
                    const opt: any = {};
                    opt.setName = jest.fn().mockReturnValue(opt);
                    opt.setDescription = jest.fn().mockReturnValue(opt);
                    opt.setRequired = jest.fn().mockReturnValue(opt);
                    optFn(opt);
                    return sub;
                });
                sub.addAttachmentOption = jest.fn().mockImplementation((optFn: any) => {
                    const opt: any = {};
                    opt.setName = jest.fn().mockReturnValue(opt);
                    opt.setDescription = jest.fn().mockReturnValue(opt);
                    opt.setRequired = jest.fn().mockReturnValue(opt);
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
        PermissionFlagsBits: { Administrator: 8n },
        // Additional mocks used in wiring
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
        workspaceBaseDir: '/workspace',
        platforms: ['discord'],
    }),
    resolveResponseDeliveryMode: jest.fn().mockReturnValue('stream'),
}));

jest.mock('better-sqlite3', () => {
    return jest.fn().mockImplementation(() => {
        return {
            exec: jest.fn(),
            pragma: jest.fn().mockReturnValue([]),
            prepare: jest.fn().mockReturnValue({ run: jest.fn(), get: jest.fn(), all: jest.fn().mockReturnValue([]) }),
            close: jest.fn(),
        };
    });
});

// Mock CDP service (prevents actual network connections)
jest.mock('../src/services/cdpService', () => {
    const EventEmitter = require('events');
    return {
        CdpService: jest.fn().mockImplementation(() => {
            const emitter = new EventEmitter();
            return Object.assign(emitter, {
                connect: jest.fn().mockRejectedValue(new Error('Test environment: CDP not connected')),
                disconnect: jest.fn().mockResolvedValue(undefined),
                discoverTarget: jest.fn().mockRejectedValue(new Error('Test environment')),
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

jest.mock('../src/services/heartbeatService', () => {
    return {
        HeartbeatService: jest.fn().mockImplementation(() => {
            return {
                init: jest.fn(),
                start: jest.fn(),
                stop: jest.fn(),
                disable: jest.fn(),
                recordActivity: jest.fn(),
                updateConfig: jest.fn().mockResolvedValue(true),
                botStartTime: Date.now() - 5000,
                lastActivityTimestamp: Date.now() - 1000,
            };
        }),
        parseInterval: jest.fn().mockReturnValue(1800000),
        formatDuration: jest.fn().mockReturnValue('30m'),
        formatRelativeTime: jest.fn().mockReturnValue('1m ago'),
    };
});

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

    it('forces response delivery mode to stream even when final-only is configured', () => {
        process.env.LAZYGRAVITY_RESPONSE_DELIVERY = 'final-only';
        expect(getResponseDeliveryModeForTest()).toBe('stream');
    });

    describe('heartbeat command interaction', () => {
        let interactionCallback: (interaction: any) => Promise<void>;
        let mockTargetChannel: any;
        let mockPermissions: any;

        const { HeartbeatService } = require('../src/services/heartbeatService');

        beforeEach(() => {
            interactionCallback = clientInstance.on.mock.calls.find((call: any) => call[0] === Events.InteractionCreate)[1];
            mockPermissions = {
                has: jest.fn().mockReturnValue(true),
            };
            mockTargetChannel = {
                id: 'heartbeat-channel-id',
                isTextBased: () => true,
                permissionsFor: jest.fn().mockReturnValue(mockPermissions),
            };
        });

        const makeMockInteraction = (overrides: {
            subcommand: string;
            interval?: string | null;
            targetChannel?: any;
            editReply?: jest.Mock;
            user?: { id: string };
        }) => {
            const editReplySpy = overrides.editReply || jest.fn().mockResolvedValue(true);
            const channel = overrides.hasOwnProperty('targetChannel') ? overrides.targetChannel : mockTargetChannel;
            return {
                isAutocomplete: () => false,
                isButton: () => false,
                isStringSelectMenu: () => false,
                isChatInputCommand: () => true,
                commandName: 'heartbeat',
                options: {
                    getSubcommand: () => overrides.subcommand,
                    getString: (name: string) => name === 'interval' ? (overrides.hasOwnProperty('interval') ? overrides.interval : '30m') : null,
                    getChannel: (name: string) => name === 'channel' ? channel : null,
                },
                client: clientInstance,
                channel,
                channelId: 'heartbeat-channel-id',
                user: overrides.user || { id: '123' }, // allowed user in mocked config
                deferReply: jest.fn().mockResolvedValue(true),
                editReply: editReplySpy,
            } as any;
        };

        it('handles heartbeat on command successfully', async () => {
            const editReplySpy = jest.fn().mockResolvedValue(true);
            const mockInteraction = makeMockInteraction({
                subcommand: 'on',
                interval: '30m',
                editReply: editReplySpy,
            });

            await interactionCallback(mockInteraction);

            expect(mockTargetChannel.permissionsFor).toHaveBeenCalledWith(clientInstance.user);
            expect(editReplySpy).toHaveBeenCalledWith(expect.objectContaining({
                content: expect.stringContaining('Heartbeat enabled'),
            }));
        });

        it('fails heartbeat on if bot lacks send permissions', async () => {
            mockPermissions.has.mockReturnValue(false);
            const editReplySpy = jest.fn().mockResolvedValue(true);
            const mockInteraction = makeMockInteraction({
                subcommand: 'on',
                interval: '30m',
                editReply: editReplySpy,
            });

            await interactionCallback(mockInteraction);

            expect(editReplySpy).toHaveBeenCalledWith(expect.objectContaining({
                content: expect.stringContaining('Bot does not have permission'),
            }));
        });

        it('fails heartbeat on if channel is not text-based', async () => {
            const nonTextChannel = {
                id: 'non-text-id',
                isTextBased: () => false,
            };
            const editReplySpy = jest.fn().mockResolvedValue(true);
            const mockInteraction = makeMockInteraction({
                subcommand: 'on',
                targetChannel: nonTextChannel,
                editReply: editReplySpy,
            });

            await interactionCallback(mockInteraction);

            expect(editReplySpy).toHaveBeenCalledWith(expect.objectContaining({
                content: expect.stringContaining('Please select a valid text channel'),
            }));
        });

        it('fails heartbeat on if interval format is invalid', async () => {
            const { parseInterval } = require('../src/services/heartbeatService');
            parseInterval.mockReturnValueOnce(null);

            const editReplySpy = jest.fn().mockResolvedValue(true);
            const mockInteraction = makeMockInteraction({
                subcommand: 'on',
                interval: 'invalid-val',
                editReply: editReplySpy,
            });

            await interactionCallback(mockInteraction);

            expect(editReplySpy).toHaveBeenCalledWith(expect.objectContaining({
                content: expect.stringContaining('Invalid interval format'),
            }));
        });

        it('fails heartbeat on if interval is below 10 seconds', async () => {
            const { parseInterval } = require('../src/services/heartbeatService');
            parseInterval.mockReturnValueOnce(5000);

            const editReplySpy = jest.fn().mockResolvedValue(true);
            const mockInteraction = makeMockInteraction({
                subcommand: 'on',
                interval: '5s',
                editReply: editReplySpy,
            });

            await interactionCallback(mockInteraction);

            expect(editReplySpy).toHaveBeenCalledWith(expect.objectContaining({
                content: expect.stringContaining('Interval must be at least 10 seconds'),
            }));
        });

        it('handles heartbeat off command successfully', async () => {
            const editReplySpy = jest.fn().mockResolvedValue(true);
            const mockInteraction = makeMockInteraction({
                subcommand: 'off',
                editReply: editReplySpy,
            });

            await interactionCallback(mockInteraction);

            const mockServiceInstance = (HeartbeatService as jest.Mock).mock.results[0].value;
            expect(mockServiceInstance.disable).toHaveBeenCalled();
            expect(editReplySpy).toHaveBeenCalledWith(expect.objectContaining({
                content: expect.stringContaining('Heartbeat disabled'),
            }));
        });

        it('handles heartbeat status command and returns status embed', async () => {
            const editReplySpy = jest.fn().mockResolvedValue(true);
            const mockInteraction = makeMockInteraction({
                subcommand: 'status',
                editReply: editReplySpy,
            });

            await interactionCallback(mockInteraction);

            expect(editReplySpy).toHaveBeenCalledWith(expect.objectContaining({
                embeds: expect.any(Array),
            }));
        });

        it('fails heartbeat on if interval is above 24.8 days', async () => {
            const { parseInterval } = require('../src/services/heartbeatService');
            parseInterval.mockReturnValueOnce(3000000000);

            const editReplySpy = jest.fn().mockResolvedValue(true);
            const mockInteraction = makeMockInteraction({
                subcommand: 'on',
                interval: '30d',
                editReply: editReplySpy,
            });

            await interactionCallback(mockInteraction);

            expect(editReplySpy).toHaveBeenCalledWith(expect.objectContaining({
                content: expect.stringContaining('Interval cannot be greater than 24.8 days'),
            }));
        });

        it('warns user of environment variables override if present', async () => {
            const originalEnv = process.env.HEARTBEAT_ENABLED;
            process.env.HEARTBEAT_ENABLED = 'false';

            try {
                const editReplySpy = jest.fn().mockResolvedValue(true);
                const mockInteraction = makeMockInteraction({
                    subcommand: 'on',
                    interval: '30m',
                    editReply: editReplySpy,
                });

                await interactionCallback(mockInteraction);

                expect(editReplySpy).toHaveBeenCalledWith(expect.objectContaining({
                    content: expect.stringContaining('Environment override(s) active: HEARTBEAT_ENABLED'),
                }));
            } finally {
                if (originalEnv === undefined) {
                    delete process.env.HEARTBEAT_ENABLED;
                } else {
                    process.env.HEARTBEAT_ENABLED = originalEnv;
                }
            }
        });

        it('excludes heartbeat commands from recording activity', async () => {
            const mockServiceInstance = (HeartbeatService as jest.Mock).mock.results[0].value;
            mockServiceInstance.recordActivity.mockClear();

            const mockInteraction = makeMockInteraction({
                subcommand: 'status',
            });

            await interactionCallback(mockInteraction);

            expect(mockServiceInstance.recordActivity).not.toHaveBeenCalled();
        });
    });
});
