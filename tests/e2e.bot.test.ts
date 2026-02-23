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
        SlashCommandBuilder: jest.fn().mockImplementation(() => {
            const builder: any = {};
            const methods = ['setName', 'setDescription', 'addStringOption', 'addSubcommand', 'addChoices', 'setRequired'];
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
        ButtonBuilder: jest.fn().mockImplementation(() => ({
            setCustomId: jest.fn().mockReturnThis(),
            setLabel: jest.fn().mockReturnThis(),
            setStyle: jest.fn().mockReturnThis(),
        })),
        StringSelectMenuBuilder: jest.fn().mockImplementation(() => ({
            setCustomId: jest.fn().mockReturnThis(),
            setPlaceholder: jest.fn().mockReturnThis(),
            addOptions: jest.fn().mockReturnThis(),
        })),
        ActionRowBuilder: jest.fn().mockImplementation(() => ({
            addComponents: jest.fn().mockReturnThis(),
        })),
        EmbedBuilder: jest.fn().mockImplementation(() => ({
            setTitle: jest.fn().mockReturnThis(),
            setDescription: jest.fn().mockReturnThis(),
            setColor: jest.fn().mockReturnThis(),
            addFields: jest.fn().mockReturnThis(),
            setTimestamp: jest.fn().mockReturnThis(),
            setFooter: jest.fn().mockReturnThis(),
        })),
        ButtonStyle: { Success: 1, Primary: 2, Danger: 4 },
    };
});

jest.mock('../src/utils/config', () => ({
    loadConfig: jest.fn().mockReturnValue({
        discordToken: 'test_token',
        clientId: 'test_client_id',
        guildId: 'test_guild_id',
        allowedUserIds: ['user123'],
        workspaceBaseDir: require('os').tmpdir()
    })
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
                injectMessage: mockCdpInjectMessage,
                injectMessageWithImageFiles: jest.fn().mockResolvedValue({ ok: true }),
                getContexts: jest.fn().mockReturnValue([{ id: 1, type: 'page' }]),
                getPrimaryContextId: jest.fn().mockReturnValue(1),
                call: jest.fn().mockResolvedValue({}),
                isConnected: jest.fn().mockReturnValue(true), // pretend we are always connected
                getCurrentModel: jest.fn().mockResolvedValue('test-model'),
            });
        }),
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
            ephemeral: true,
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
    });

    it('P0-07: Template Add and Use', async () => {
        // 0. Bind project first (Covering part of P0-02)
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
            guild: { id: 'test_guild' },
            channelId: '123456789',
        };

        // Needs to be handled properly including the prompt injection.
        await interactionHandler(useInteraction);

        // Since it invokes Antigravity, CDP should be called or at least mock Cdp injected message
        await new Promise(r => setTimeout(r, 50));
        expect(mockCdpInjectMessage).toHaveBeenCalledWith('Hello this is test prompt');
    });

});
