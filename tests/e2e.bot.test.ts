import { Client, GatewayIntentBits, Events } from 'discord.js';
import { startBot } from '../src/bot';
import { loadConfig } from '../src/utils/config';

// Require the real sqlite3 for memory DB, but don't mock it so that we actually test repository behavior.
process.env.NODE_ENV = 'test';

const mockSend = jest.fn().mockResolvedValue({ edit: jest.fn().mockResolvedValue({}) });
const mockEditReply = jest.fn().mockResolvedValue({});
const mockReply = jest.fn().mockResolvedValue({});
const mockReact = jest.fn().mockResolvedValue({});

jest.mock('discord.js', () => {
    const actual = jest.requireActual('discord.js');
    return {
        ...actual,
        Client: jest.fn().mockImplementation(() => {
            return {
                once: jest.fn(),
                on: jest.fn(),
                login: jest.fn().mockResolvedValue('test_token'),
                guilds: { cache: new Map() },
                user: { id: 'bot-id' },
            };
        }),
        Message: class Message {
            public id = 'mock_msg_id';
            public guildId = 'test_guild';
            public channel = {
                id: '123456789',
                send: jest.fn().mockResolvedValue({ id: 'msg_id', edit: jest.fn() }),
                sendTyping: jest.fn()
            };
            public react = jest.fn().mockResolvedValue(undefined);
            public reactions = { resolve: () => undefined };
            constructor() { }
        },
        SlashCommandBuilder: jest.fn().mockImplementation(() => {
            const builder: any = {};
            const methods = [
                'setName',
                'setDescription',
                'addStringOption',
                'addIntegerOption',
                'addSubcommand',
                'addChoices',
                'setRequired',
                'setMinValue',
                'setMaxValue'
            ];
            for (const m of methods) {
                builder[m] = jest.fn().mockImplementation((fnOrVal) => {
                    if (typeof fnOrVal === 'function') {
                        const sub: any = { ...builder };
                        fnOrVal(sub);
                    }
                    return builder;
                });
            }
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
    };
});

jest.mock('../src/utils/config', () => ({
    loadConfig: jest.fn().mockReturnValue({
        discordToken: 'test_token',
        clientId: 'test_client_id',
        guildId: 'test_guild_id',
        allowedUserIds: ['user123'],
        workspaceBaseDir: require('os').tmpdir()
    }),
    resolveResponseDeliveryMode: jest.fn().mockReturnValue('stream'),
}));

const mockCdpInjectMessage = jest.fn().mockResolvedValue({ ok: true });
jest.mock('../src/services/cdpService', () => {
    const EventEmitter = require('events');
    return {
        CdpService: jest.fn().mockImplementation(() => {
            const emitter = new EventEmitter();
            return Object.assign(emitter, {
                connect: jest.fn().mockResolvedValue(undefined),
                disconnect: jest.fn().mockResolvedValue(undefined),
                discoverTarget: jest.fn().mockResolvedValue(undefined),
                discoverAndConnectForWorkspace: jest.fn().mockResolvedValue(undefined),
                injectMessage: mockCdpInjectMessage,
                injectMessageWithImageFiles: jest.fn().mockResolvedValue({ ok: true }),
                getContexts: jest.fn().mockReturnValue([{ id: 1, type: 'page' }]),
                getPrimaryContextId: jest.fn().mockReturnValue(1),
                call: jest.fn().mockResolvedValue({}),
                isConnected: jest.fn().mockReturnValue(true), // pretend we are always connected
                getCurrentModel: jest.fn().mockResolvedValue('test-model'),
                getUiModels: jest.fn().mockResolvedValue(['model-a', 'model-b']),
                setUiModel: jest.fn().mockResolvedValue({ ok: true, model: 'model-a' }),
            });
        }),
    };
});

jest.mock('../src/services/promptDispatcher', () => {
    return {
        PromptDispatcher: jest.fn().mockImplementation(() => {
            return {
                send: jest.fn().mockImplementation(async (req: any) => {
                    await req.cdp.injectMessage(req.prompt);
                }),
            };
        }),
    };
});

jest.mock('../src/services/approvalDetector', () => {
    return {
        ApprovalDetector: jest.fn().mockImplementation(() => {
            return {
                isActive: jest.fn().mockReturnValue(true),
                start: jest.fn(),
                stop: jest.fn(),
                approveButton: jest.fn().mockResolvedValue(true),
                denyButton: jest.fn().mockResolvedValue(true),
                alwaysAllowButton: jest.fn().mockResolvedValue(true)
            };
        })
    };
});

describe('Bot E2E Flow', () => {
    let clientInstance: any;
    let interactionHandler: Function;
    let messageHandler: Function;

    beforeAll(async () => {
        // Start the bot using real memory DB, fake Discord client and CDP layer
        await startBot();
        clientInstance = (Client as unknown as jest.Mock).mock.results[0].value;
        const interactionCall = clientInstance.on.mock.calls.find((call: any[]) => call[0] === Events.InteractionCreate);
        const messageCall = clientInstance.on.mock.calls.find((call: any[]) => call[0] === Events.MessageCreate);

        interactionHandler = interactionCall[1];
        messageHandler = messageCall[1];
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('P0-01: Rejects unauthorized users', async () => {
        const interaction = {
            isButton: () => false,
            isAnySelectMenu: () => false,
            isStringSelectMenu: () => false,
            isChatInputCommand: () => true,
            isMessageComponent: () => false,
            user: { id: 'unauthorized_user' },
            commandName: 'help',
            options: { getSubcommand: () => null, getString: () => null },
            reply: mockReply,
        };

        await interactionHandler(interaction);

        expect(mockReply).toHaveBeenCalledWith({
            content: expect.stringMatching(/権限がありません/),
            flags: 64,
        });
    });

    it('P0-05: Mode Switch allows changing modes', async () => {
        const interaction = {
            isButton: () => false,
            isAnySelectMenu: () => false,
            isStringSelectMenu: () => false,
            isChatInputCommand: () => true,
            isMessageComponent: () => false,
            user: { id: 'user123' },
            commandName: 'mode',
            options: { getSubcommand: () => null, getString: () => 'plan' }, // Setting to plan mode
            reply: mockReply,
            deferReply: jest.fn().mockResolvedValue(undefined),
            editReply: mockEditReply,
        };

        await interactionHandler(interaction);

        expect(mockEditReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.any(String) // "✅ Mode changed to plan"
        }));
        jest.clearAllMocks();
    });

    it('P0-02: Project Creation Flow (/project)', async () => {
        const projectCreateInteraction = {
            isButton: () => false,
            isAnySelectMenu: () => false,
            isStringSelectMenu: () => false,
            isChatInputCommand: () => true,
            isMessageComponent: () => false,
            user: { id: 'user123' },
            commandName: 'project',
            options: {
                getSubcommand: () => 'create',
                getString: () => 'test_project'
            },
            reply: mockReply,
            deferReply: jest.fn().mockResolvedValue(undefined),
            editReply: mockEditReply,
            guild: {
                id: 'test_guild',
                channels: {
                    create: jest.fn().mockResolvedValue({ id: 'cat_id', name: 'session-1' }),
                    fetch: jest.fn().mockResolvedValue(Object.assign([
                        { id: 'cat_id', type: 4, name: '🗂️-test_project' }
                    ], { get: () => null })),
                    cache: {
                        find: jest.fn().mockReturnValue(undefined),
                        values: () => []
                    }
                }
            },
            channelId: '123456789',
        };

        await interactionHandler(projectCreateInteraction);

        // Verify project created embed
        expect(mockEditReply).toHaveBeenCalledWith(expect.objectContaining({
            embeds: expect.arrayContaining([
                expect.objectContaining({
                    data: expect.objectContaining({
                        title: expect.stringMatching(/Project Created/)
                    })
                })
            ])
        }));
    });

    it('P0-07: Template Add and Use', async () => {
        // 1. Add template
        const addInteraction = {
            isButton: () => false,
            isAnySelectMenu: () => false,
            isStringSelectMenu: () => false,
            isChatInputCommand: () => true,
            isMessageComponent: () => false,
            user: { id: 'user123' },
            commandName: 'template',
            options: {
                getSubcommand: () => 'add',
                getString: (name: string) => name === 'name' ? 'my_template' : 'Hello this is test prompt'
            },
            reply: mockReply,
            deferReply: jest.fn().mockResolvedValue(undefined),
            editReply: mockEditReply,
        };

        await interactionHandler(addInteraction);
        expect(mockEditReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringMatching(/my_template/)
        }));

        jest.clearAllMocks();

        // 1.5 Establish CDP connection by sending a normal message inside the created project channel
        const mockMsg: any = {
            author: { bot: false, id: 'user123' },
            content: 'Hello Antigravity',
            channelId: 'cat_id',
            channel: { id: 'cat_id', send: jest.fn().mockResolvedValue({}) },
            react: jest.fn().mockResolvedValue(undefined),
            reply: jest.fn().mockImplementation(async (msg) => { console.error('MOCK_MSG_REPLY:', msg); }),
            attachments: { values: () => [] },
            client: clientInstance
        };
        await messageHandler(mockMsg);

        // Wait for connection to settle
        await new Promise(r => setTimeout(r, 50));

        // 2. Use template
        const useInteraction = {
            isButton: () => false,
            isAnySelectMenu: () => false,
            isStringSelectMenu: () => false,
            isChatInputCommand: () => true,
            isMessageComponent: () => false,
            user: { id: 'user123' },
            commandName: 'template',
            options: {
                getSubcommand: () => 'use',
                getString: () => 'my_template'
            },
            reply: mockReply,
            deferReply: jest.fn().mockResolvedValue(undefined),
            editReply: mockEditReply,
            followUp: jest.fn().mockImplementation(async () => {
                const { Message } = require('discord.js');
                return new Message();
            }),
            guild: { id: 'test_guild' },
            channelId: '123456789',
            channel: { id: '123456789' },
        };

        // Needs to be handled properly including the prompt injection.
        await interactionHandler(useInteraction);

        // Since it invokes Antigravity, CDP should be called or at least mock Cdp injected message
        await new Promise(r => setTimeout(r, 50));
        expect(mockCdpInjectMessage).toHaveBeenCalledWith('Hello this is test prompt');
    });

    it('P0-08: Control commands (/status, /stop)', async () => {
        // Test /status
        const statusInteraction = {
            isButton: () => false,
            isAnySelectMenu: () => false,
            isStringSelectMenu: () => false,
            isChatInputCommand: () => true,
            isMessageComponent: () => false,
            user: { id: 'user123' },
            commandName: 'status',
            options: { getSubcommand: () => null, getString: () => null },
            reply: mockReply,
            deferReply: jest.fn().mockResolvedValue(undefined),
            editReply: mockEditReply,
        };

        await interactionHandler(statusInteraction);
        expect(mockEditReply).toHaveBeenCalledWith(expect.objectContaining({
            embeds: expect.arrayContaining([
                expect.objectContaining({
                    data: expect.objectContaining({
                        title: expect.stringMatching(/Bot ステータス/)
                    })
                })
            ])
        }));

        jest.clearAllMocks();

        // Test /stop
        const stopInteraction = {
            ...statusInteraction,
            commandName: 'stop',
        };

        await interactionHandler(stopInteraction);
        // since we are mocked as connected, it should attempt to stop and send an embed
        expect(mockEditReply).toHaveBeenCalledWith(expect.objectContaining({
            embeds: expect.arrayContaining([
                expect.objectContaining({
                    data: expect.objectContaining({
                        title: expect.stringMatching(/停止できませんでした|中しました/)
                    })
                })
            ])
        }));
    });

    it('P0-03 & P0-04: Session Management (/new) and Message Sending', async () => {
        // Test /new
        const newInteraction = {
            isButton: () => false,
            isAnySelectMenu: () => false,
            isStringSelectMenu: () => false,
            isChatInputCommand: () => true,
            isMessageComponent: () => false,
            user: { id: 'user123' },
            commandName: 'new',
            options: { getSubcommand: () => null, getString: () => null },
            reply: mockReply,
            deferReply: jest.fn().mockResolvedValue(undefined),
            editReply: mockEditReply,
            guild: {
                id: 'test_guild',
                channels: {
                    create: jest.fn().mockResolvedValue({ id: 'cat_id2', name: 'session-2' }),
                }
            },
            channelId: 'cat_id', // Assume we are in the session we created previously
            channel: {
                id: 'cat_id',
                type: 0, // ChannelType.GuildText is 0
                parentId: 'cat_id', // Parent category id
                setName: jest.fn().mockResolvedValue({}),
                send: jest.fn().mockResolvedValue({})
            },
        };

        await interactionHandler(newInteraction);
        expect(mockEditReply).toHaveBeenCalledWith(expect.objectContaining({
            embeds: expect.arrayContaining([
                expect.objectContaining({
                    data: expect.objectContaining({
                        title: expect.stringMatching(/Started a new session/)
                    })
                })
            ])
        }));

        jest.clearAllMocks();

        // Test normal text message to trigger CDP message inject
        const msg = {
            author: { bot: false, id: 'user123' },
            content: 'Please explain quantum computing',
            channelId: 'cat_id', // same channel that is bound
            channel: { id: 'cat_id', send: jest.fn().mockResolvedValue({}) },
            react: jest.fn().mockResolvedValue(undefined),
            reply: jest.fn().mockResolvedValue(undefined),
            attachments: { values: () => [] },
            client: clientInstance
        };

        await messageHandler(msg);

        // Wait a bit to let the async process reach CDP injection
        await new Promise(resolve => setTimeout(resolve, 50));

        // It should have injected the text to mock CDP
        expect(mockCdpInjectMessage).toHaveBeenCalledWith('Please explain quantum computing');
    });

    it('P0-06: Model Command (/model)', async () => {
        // Test /model without args
        const modelInteractionList = {
            isButton: () => false,
            isAnySelectMenu: () => false,
            isStringSelectMenu: () => false,
            isChatInputCommand: () => true,
            isMessageComponent: () => false,
            user: { id: 'user123' },
            commandName: 'model',
            options: { getSubcommand: () => null, getString: () => null },
            reply: mockReply,
            deferReply: jest.fn().mockResolvedValue(undefined),
            editReply: mockEditReply,
            guild: { id: 'test_guild' }
        };

        await interactionHandler(modelInteractionList);
        expect(mockEditReply).toHaveBeenCalledWith(expect.objectContaining({
            embeds: expect.arrayContaining([
                expect.objectContaining({
                    data: expect.objectContaining({
                        title: expect.stringMatching(/モデル管理/)
                    })
                })
            ])
        }));

        jest.clearAllMocks();

        // Test /model with target model name
        const modelInteractionSet = {
            ...modelInteractionList,
            options: { getSubcommand: () => null, getString: () => 'model-a' }
        };
        await interactionHandler(modelInteractionSet);

        expect(mockEditReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringMatching(/変更しました/)
        }));
    });

    it('P0-09: Approval Button Integration', async () => {
        const approveInteraction: any = {
            isButton: () => true,
            isAnySelectMenu: () => false,
            isStringSelectMenu: () => false,
            isChatInputCommand: () => false,
            isMessageComponent: () => true,
            user: { id: 'user123' },
            customId: 'approve_action:test_project',
            reply: mockReply,
            deferReply: jest.fn().mockResolvedValue(undefined),
            editReply: mockEditReply,
            update: jest.fn().mockResolvedValue(undefined),
            message: { id: 'msg123', embeds: [{}], components: [] },
            channelId: 'cat_id',
        };

        await interactionHandler(approveInteraction);
        expect(approveInteraction.update).toHaveBeenCalled();

        jest.clearAllMocks();

        const denyInteraction = {
            ...approveInteraction,
            customId: 'deny_action:test_project',
        };

        await interactionHandler(denyInteraction);
        expect(denyInteraction.update).toHaveBeenCalled();
    });

    it('P0-11: Persistence Check (/templates list)', async () => {
        const listInteraction = {
            isButton: () => false,
            isAnySelectMenu: () => false,
            isStringSelectMenu: () => false,
            isChatInputCommand: () => true,
            isMessageComponent: () => false,
            user: { id: 'user123' },
            commandName: 'template',
            options: { getSubcommand: () => null, getString: () => null },
            reply: mockReply,
            deferReply: jest.fn().mockResolvedValue(undefined),
            editReply: mockEditReply,
            guild: { id: 'test_guild' }
        };

        await interactionHandler(listInteraction);

        // Verify that the template 'my_template' created in P0-07 is still available, proving DB persistence (in-memory for this test).
        expect(mockEditReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringMatching(/my_template/)
        }));
    });

});
