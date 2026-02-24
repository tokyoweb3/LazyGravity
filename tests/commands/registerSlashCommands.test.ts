const mockPut = jest.fn();

jest.mock('discord.js', () => {
    class MockSlashCommandBuilder {
        private data: Record<string, unknown> = {};

        setName(name: string) {
            this.data.name = name;
            return this;
        }

        setDescription(_description: string) {
            return this;
        }

        addStringOption(fn: (option: any) => void) {
            const option = {
                setName: jest.fn().mockReturnThis(),
                setDescription: jest.fn().mockReturnThis(),
                setRequired: jest.fn().mockReturnThis(),
            };
            fn(option);
            return this;
        }

        addIntegerOption(fn: (option: any) => void) {
            const option = {
                setName: jest.fn().mockReturnThis(),
                setDescription: jest.fn().mockReturnThis(),
                setRequired: jest.fn().mockReturnThis(),
                setMinValue: jest.fn().mockReturnThis(),
                setMaxValue: jest.fn().mockReturnThis(),
            };
            fn(option);
            return this;
        }

        addSubcommand(fn: (sub: any) => void) {
            const sub = {
                setName: jest.fn().mockReturnThis(),
                setDescription: jest.fn().mockReturnThis(),
                addStringOption: jest.fn().mockImplementation((optFn: (option: any) => void) => {
                    const option = {
                        setName: jest.fn().mockReturnThis(),
                        setDescription: jest.fn().mockReturnThis(),
                        setRequired: jest.fn().mockReturnThis(),
                    };
                    optFn(option);
                    return sub;
                }),
            };
            fn(sub);
            return this;
        }

        toJSON() {
            return this.data;
        }
    }

    return {
        SlashCommandBuilder: MockSlashCommandBuilder,
        REST: jest.fn().mockImplementation(() => ({
            setToken: jest.fn().mockReturnThis(),
            put: mockPut,
        })),
        Routes: {
            applicationCommands: jest.fn().mockReturnValue('/global-commands'),
            applicationGuildCommands: jest.fn().mockReturnValue('/guild-commands'),
        },
    };
});

import { REST, Routes } from 'discord.js';
import { registerSlashCommands, slashCommands } from '../../src/commands/registerSlashCommands';

describe('registerSlashCommands', () => {
    it('includes the autoaccept command in registration targets', () => {
        const names = slashCommands.map((cmd) => cmd.toJSON().name);
        expect(names).toContain('autoaccept');
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('registers as guild commands when guildId is specified', async () => {
        await registerSlashCommands('token', 'client-id', 'guild-id');

        expect(Routes.applicationGuildCommands).toHaveBeenCalledWith('client-id', 'guild-id');
        expect(mockPut).toHaveBeenCalledWith('/guild-commands', {
            body: expect.any(Array),
        });

        const body = mockPut.mock.calls[0][1].body as unknown[];
        expect(body).toHaveLength(slashCommands.length);
    });

    it('registers as global commands when guildId is not specified', async () => {
        await registerSlashCommands('token', 'client-id');

        expect(Routes.applicationCommands).toHaveBeenCalledWith('client-id');
        expect(mockPut).toHaveBeenCalledWith('/global-commands', {
            body: expect.any(Array),
        });
    });

    it('re-throws the exception when REST registration fails', async () => {
        mockPut.mockRejectedValueOnce(new Error('register failed'));

        await expect(registerSlashCommands('token', 'client-id')).rejects.toThrow('register failed');
        expect(REST).toHaveBeenCalled();
    });
});
