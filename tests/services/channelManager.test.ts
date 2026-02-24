import { ChannelManager } from '../../src/services/channelManager';
import { ChannelType, Guild, CategoryChannel, TextChannel, Collection } from 'discord.js';

/**
 * Step 8: Tests for channel/category auto-generation logic
 *
 * Test targets:
 * - Create Discord category/channel from a relative path if they don't exist
 * - Return existing category/channel IDs if they already exist
 * - Category name sanitization (Discord constraint compliance)
 */

// Helper function to mock discord.js objects
function createMockGuild(existingChannels: Array<{ id: string; name: string; type: ChannelType; parentId?: string | null }>): Guild {
    const channelCollection = new Collection<string, any>();

    for (const ch of existingChannels) {
        channelCollection.set(ch.id, {
            id: ch.id,
            name: ch.name,
            type: ch.type,
            parentId: ch.parentId ?? null,
            // Categories have a children property
            ...(ch.type === ChannelType.GuildCategory ? {
                children: {
                    cache: new Collection<string, any>()
                }
            } : {}),
        });
    }

    const mockGuild = {
        channels: {
            cache: channelCollection,
            fetch: jest.fn().mockResolvedValue(channelCollection),
            create: jest.fn(),
        },
    } as unknown as Guild;

    return mockGuild;
}

describe('ChannelManager', () => {
    let channelManager: ChannelManager;

    beforeEach(() => {
        jest.clearAllMocks();
        channelManager = new ChannelManager();
    });

    describe('ensureChannel - when category does not exist', () => {
        it('creates a new category and text channel, and returns the channel ID', async () => {
            // Empty guild (no channels)
            const mockGuild = createMockGuild([]);

            // Mock for category creation
            const mockCategory = {
                id: 'cat-new-1',
                name: '🗂️-frontend',
                type: ChannelType.GuildCategory,
            };
            // Mock for text channel creation
            const mockTextChannel = {
                id: 'ch-new-1',
                name: 'general',
                type: ChannelType.GuildText,
                parentId: 'cat-new-1',
            };

            (mockGuild.channels.create as jest.Mock)
                .mockResolvedValueOnce(mockCategory)   // 1st: category creation
                .mockResolvedValueOnce(mockTextChannel); // 2nd: channel creation

            const result = await channelManager.ensureChannel(mockGuild, 'frontend');

            // Category should be created
            expect(mockGuild.channels.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: '🗂️-frontend',
                    type: ChannelType.GuildCategory,
                })
            );
            // Text channel should be created under the category
            expect(mockGuild.channels.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'general',
                    type: ChannelType.GuildText,
                    parent: 'cat-new-1',
                })
            );
            // Return value channel ID should be correct
            expect(result).toEqual({
                categoryId: 'cat-new-1',
                channelId: 'ch-new-1',
                created: true,
            });
        });
    });

    describe('ensureChannel - when category already exists', () => {
        it('returns the existing ID when a text channel exists under the existing category', async () => {
            const mockGuild = createMockGuild([
                { id: 'cat-existing', name: '🗂️-frontend', type: ChannelType.GuildCategory },
                { id: 'ch-existing', name: 'general', type: ChannelType.GuildText, parentId: 'cat-existing' },
            ]);

            const result = await channelManager.ensureChannel(mockGuild, 'frontend');

            // Existing IDs should be returned
            expect(result).toEqual({
                categoryId: 'cat-existing',
                channelId: 'ch-existing',
                created: false,
            });
            // Creation API should not be called
            expect(mockGuild.channels.create).not.toHaveBeenCalled();
        });

        it('creates only the text channel when the category exists but has no text channel', async () => {
            const mockGuild = createMockGuild([
                { id: 'cat-existing-2', name: '🗂️-backend', type: ChannelType.GuildCategory },
            ]);

            const mockTextChannel = {
                id: 'ch-new-backend',
                name: 'general',
                type: ChannelType.GuildText,
                parentId: 'cat-existing-2',
            };

            (mockGuild.channels.create as jest.Mock)
                .mockResolvedValueOnce(mockTextChannel);

            const result = await channelManager.ensureChannel(mockGuild, 'backend');

            // Category creation is not called (only text channel is created)
            expect(mockGuild.channels.create).toHaveBeenCalledTimes(1);
            expect(mockGuild.channels.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'general',
                    type: ChannelType.GuildText,
                    parent: 'cat-existing-2',
                })
            );
            expect(result).toEqual({
                categoryId: 'cat-existing-2',
                channelId: 'ch-new-backend',
                created: true,
            });
        });
    });

    describe('sanitizeCategoryName - category name sanitization', () => {
        it('converts slashes to hyphens', () => {
            expect(channelManager.sanitizeCategoryName('frontend/src')).toBe('frontend-src');
        });

        it('converts uppercase to lowercase', () => {
            expect(channelManager.sanitizeCategoryName('MyProject')).toBe('myproject');
        });

        it('removes trailing slashes', () => {
            expect(channelManager.sanitizeCategoryName('frontend/')).toBe('frontend');
        });

        it('collapses consecutive hyphens into one', () => {
            expect(channelManager.sanitizeCategoryName('my--project')).toBe('my-project');
        });

        it('removes characters not allowed in Discord channel names', () => {
            expect(channelManager.sanitizeCategoryName('my project@v2!')).toBe('my-project-v2');
        });

        it('truncates names exceeding 100 characters', () => {
            const longName = 'a'.repeat(150);
            expect(channelManager.sanitizeCategoryName(longName).length).toBeLessThanOrEqual(100);
        });
    });

    describe('ensureCategory', () => {
        it('creates a new category when it does not exist', async () => {
            const mockGuild = createMockGuild([]);
            const mockCategory = { id: 'cat-new', name: '🗂️-myproject' };
            (mockGuild.channels.create as jest.Mock).mockResolvedValueOnce(mockCategory);

            const result = await channelManager.ensureCategory(mockGuild, 'myproject');

            expect(result).toEqual({ categoryId: 'cat-new', created: true });
            expect(mockGuild.channels.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: '🗂️-myproject',
                    type: ChannelType.GuildCategory,
                })
            );
        });

        it('returns the existing ID when the category already exists', async () => {
            const mockGuild = createMockGuild([
                { id: 'cat-existing', name: '🗂️-myproject', type: ChannelType.GuildCategory },
            ]);

            const result = await channelManager.ensureCategory(mockGuild, 'myproject');

            expect(result).toEqual({ categoryId: 'cat-existing', created: false });
            expect(mockGuild.channels.create).not.toHaveBeenCalled();
        });
    });

    describe('createSessionChannel', () => {
        it('creates a session channel under the category', async () => {
            const mockGuild = createMockGuild([]);
            const mockChannel = { id: 'ch-session-1', name: 'session-1' };
            (mockGuild.channels.create as jest.Mock).mockResolvedValueOnce(mockChannel);

            const result = await channelManager.createSessionChannel(mockGuild, 'cat-1', 'session-1');

            expect(result).toEqual({ channelId: 'ch-session-1' });
            expect(mockGuild.channels.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'session-1',
                    type: ChannelType.GuildText,
                    parent: 'cat-1',
                })
            );
        });
    });

    describe('renameChannel', () => {
        it('renames the channel', async () => {
            const mockSetName = jest.fn().mockResolvedValue(undefined);
            const channelCollection = new Collection<string, any>();
            channelCollection.set('ch-1', { id: 'ch-1', setName: mockSetName });

            const mockGuild = { channels: { cache: channelCollection } } as unknown as Guild;

            await channelManager.renameChannel(mockGuild, 'ch-1', '1-react-auth-bug');

            expect(mockSetName).toHaveBeenCalledWith('1-react-auth-bug');
        });

        it('throws an error when the channel is not found', async () => {
            const mockGuild = createMockGuild([]);

            await expect(
                channelManager.renameChannel(mockGuild, 'nonexistent', 'new-name')
            ).rejects.toThrow('Channel nonexistent not found');
        });
    });

    describe('sanitizeChannelName', () => {
        it('returns the same result as sanitizeCategoryName', () => {
            expect(channelManager.sanitizeChannelName('Hello World')).toBe(
                channelManager.sanitizeCategoryName('Hello World')
            );
        });
    });

    describe('ensureChannel - error handling', () => {
        it('propagates errors when the Discord API returns an error', async () => {
            const mockGuild = createMockGuild([]);

            (mockGuild.channels.create as jest.Mock)
                .mockRejectedValueOnce(new Error('Discord APIエラー: 権限不足'));

            await expect(
                channelManager.ensureChannel(mockGuild, 'frontend')
            ).rejects.toThrow('Discord APIエラー: 権限不足');
        });

        it('throws an error when an empty workspace path is provided', async () => {
            const mockGuild = createMockGuild([]);

            await expect(
                channelManager.ensureChannel(mockGuild, '')
            ).rejects.toThrow('Workspace path not specified');
        });
    });
});
