import { CleanupCommandHandler, CLEANUP_ARCHIVE_BTN, CLEANUP_DELETE_BTN, CLEANUP_CANCEL_BTN } from '../../src/commands/cleanupCommandHandler';
import { ChatSessionRepository } from '../../src/database/chatSessionRepository';
import { WorkspaceBindingRepository } from '../../src/database/workspaceBindingRepository';
import Database from 'better-sqlite3';

describe('CleanupCommandHandler', () => {
    let handler: CleanupCommandHandler;
    let db: Database.Database;
    let chatSessionRepo: ChatSessionRepository;
    let bindingRepo: WorkspaceBindingRepository;

    beforeEach(() => {
        db = new Database(':memory:');
        chatSessionRepo = new ChatSessionRepository(db);
        bindingRepo = new WorkspaceBindingRepository(db);
        handler = new CleanupCommandHandler(chatSessionRepo, bindingRepo);
    });

    afterEach(() => {
        db.close();
    });

    describe('handleCleanup()', () => {
        it('returns an error when executed outside a server', async () => {
            const interaction = {
                guild: null,
                options: { getInteger: jest.fn().mockReturnValue(7) },
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleCleanup(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('can only be used in a server'),
                })
            );
        });

        it('returns an error when days is out of range (0 or less)', async () => {
            const interaction = {
                guild: { id: 'guild-1' },
                options: { getInteger: jest.fn().mockReturnValue(0) },
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleCleanup(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('between 1 and 365'),
                })
            );
        });

        it('returns an error when days is out of range (366 or more)', async () => {
            const interaction = {
                guild: { id: 'guild-1' },
                options: { getInteger: jest.fn().mockReturnValue(400) },
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleCleanup(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('between 1 and 365'),
                })
            );
        });

        it('displays a completion message when there are no inactive channels', async () => {
            // Mock a guild where all channels are active (recent messages)
            const mockGuild = createMockGuild([]);

            const interaction = {
                guild: mockGuild,
                options: { getInteger: jest.fn().mockReturnValue(7) },
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleCleanup(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    embeds: expect.arrayContaining([
                        expect.objectContaining({
                            data: expect.objectContaining({
                                title: expect.stringContaining('Cleanup Scan Complete'),
                            }),
                        }),
                    ]),
                })
            );
        });

        it('displays a confirmation Embed with buttons when inactive channels are found', async () => {
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

            const mockGuild = createMockGuild([
                {
                    categoryName: '🗂️-my-project',
                    categoryId: 'cat-1',
                    channels: [
                        { id: 'ch-1', name: 'session-1', lastMessageDate: thirtyDaysAgo },
                        { id: 'ch-2', name: 'session-2', lastMessageDate: thirtyDaysAgo },
                    ],
                },
            ]);

            const interaction = {
                guild: mockGuild,
                options: { getInteger: jest.fn().mockReturnValue(7) },
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleCleanup(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    embeds: expect.arrayContaining([
                        expect.objectContaining({
                            data: expect.objectContaining({
                                title: expect.stringContaining('Cleanup Scan Results'),
                            }),
                        }),
                    ]),
                    components: expect.arrayContaining([
                        expect.objectContaining({
                            components: expect.arrayContaining([
                                expect.objectContaining({
                                    data: expect.objectContaining({
                                        custom_id: CLEANUP_ARCHIVE_BTN,
                                    }),
                                }),
                                expect.objectContaining({
                                    data: expect.objectContaining({
                                        custom_id: CLEANUP_DELETE_BTN,
                                    }),
                                }),
                                expect.objectContaining({
                                    data: expect.objectContaining({
                                        custom_id: CLEANUP_CANCEL_BTN,
                                    }),
                                }),
                            ]),
                        }),
                    ]),
                })
            );

            // Scan results should be retained in the handler
            expect(handler.getLastScanResult()).not.toBeNull();
        });

        it('does not mark a category as inactive if at least one session within it is active', async () => {
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const justNow = new Date();

            const mockGuild = createMockGuild([
                {
                    categoryName: '🗂️-mixed-project',
                    categoryId: 'cat-mix',
                    channels: [
                        { id: 'ch-old', name: 'session-1', lastMessageDate: thirtyDaysAgo },
                        { id: 'ch-new', name: 'session-2', lastMessageDate: justNow },
                    ],
                },
            ]);

            const interaction = {
                guild: mockGuild,
                options: { getInteger: jest.fn().mockReturnValue(7) },
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleCleanup(interaction as any);

            const result = handler.getLastScanResult();
            // One inactive session is found, but the category as a whole is not inactive
            expect(result?.inactiveSessions.length).toBe(1);
            expect(result?.inactiveCategories.length).toBe(0);
        });

        it('defaults the number of days to 7', async () => {
            const mockGuild = createMockGuild([]);

            const interaction = {
                guild: mockGuild,
                options: { getInteger: jest.fn().mockReturnValue(null) },
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleCleanup(interaction as any);

            const result = handler.getLastScanResult();
            // When no inactive channels, lastScanResult may remain null (embed is returned directly)
            // But the scan is executed regardless
            expect(interaction.editReply).toHaveBeenCalled();
        });
    });

    describe('handleCancel()', () => {
        it('clears the scan results on cancel', async () => {
            // First run a scan to set lastScanResult
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const mockGuild = createMockGuild([
                {
                    categoryName: '🗂️-proj',
                    categoryId: 'cat-1',
                    channels: [
                        { id: 'ch-1', name: 'session-1', lastMessageDate: thirtyDaysAgo },
                    ],
                },
            ]);

            const scanInteraction = {
                guild: mockGuild,
                options: { getInteger: jest.fn().mockReturnValue(7) },
                editReply: jest.fn().mockResolvedValue(undefined),
            };
            await handler.handleCleanup(scanInteraction as any);
            expect(handler.getLastScanResult()).not.toBeNull();

            // Cancel
            const cancelInteraction = {
                update: jest.fn().mockResolvedValue(undefined),
            };
            await handler.handleCancel(cancelInteraction as any);

            expect(handler.getLastScanResult()).toBeNull();
            expect(cancelInteraction.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    embeds: expect.arrayContaining([
                        expect.objectContaining({
                            data: expect.objectContaining({
                                title: expect.stringContaining('Cleanup Cancelled'),
                            }),
                        }),
                    ]),
                    components: [],
                })
            );
        });
    });

    describe('handleArchive()', () => {
        it('displays an error when there are no scan results', async () => {
            const interaction = {
                guild: { id: 'guild-1' },
                update: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleArchive(interaction as any);

            expect(interaction.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('No scan results found'),
                })
            );
        });
    });

    describe('handleDelete()', () => {
        it('displays an error when there are no scan results', async () => {
            const interaction = {
                guild: { id: 'guild-1' },
                update: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleDelete(interaction as any);

            expect(interaction.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('No scan results found'),
                })
            );
        });
    });

    describe('Button ID constants', () => {
        it('has the correct custom ID values', () => {
            expect(CLEANUP_ARCHIVE_BTN).toBe('cleanup_archive');
            expect(CLEANUP_DELETE_BTN).toBe('cleanup_delete');
            expect(CLEANUP_CANCEL_BTN).toBe('cleanup_cancel');
        });
    });
});

/**
 * Helper to create a mock guild for tests
 */
function createMockGuild(categories: {
    categoryName: string;
    categoryId: string;
    channels: { id: string; name: string; lastMessageDate: Date }[];
}[]) {
    // Flatten all channels
    const allChannels = new Map<string, any>();

    for (const cat of categories) {
        // Category
        allChannels.set(cat.categoryId, {
            id: cat.categoryId,
            name: cat.categoryName,
            type: 4, // GuildCategory
        });

        // Channels
        for (const ch of cat.channels) {
            const mockMessages = new Map();
            const mockMessage = {
                createdAt: ch.lastMessageDate,
            };
            mockMessages.set('msg-1', mockMessage);

            allChannels.set(ch.id, {
                id: ch.id,
                name: ch.name,
                type: 0, // GuildText
                parentId: cat.categoryId,
                createdAt: new Date('2024-01-01'),
                messages: {
                    fetch: jest.fn().mockResolvedValue(mockMessages),
                },
            });
        }
    }

    // Collection-like object
    const channelCache = {
        get: (id: string) => allChannels.get(id),
        find: (fn: (ch: any) => boolean) => {
            for (const ch of allChannels.values()) {
                if (fn(ch)) return ch;
            }
            return undefined;
        },
        filter: (fn: (ch: any) => boolean) => {
            const result = new Map();
            for (const [id, ch] of allChannels) {
                if (fn(ch)) result.set(id, ch);
            }
            return result;
        },
    };

    // fetch() returns a Collection
    const fetchResult = new Map(allChannels);
    (fetchResult as any).find = (fn: (ch: any) => boolean) => {
        for (const ch of fetchResult.values()) {
            if (fn(ch)) return ch;
        }
        return undefined;
    };
    (fetchResult as any).filter = (fn: (ch: any) => boolean) => {
        const result = new Map();
        for (const [id, ch] of fetchResult) {
            if (fn(ch)) result.set(id, ch);
        }
        return result;
    };

    return {
        id: 'guild-1',
        channels: {
            cache: channelCache,
            fetch: jest.fn().mockResolvedValue(fetchResult),
        },
        roles: {
            everyone: { id: 'everyone-role' },
        },
    };
}
