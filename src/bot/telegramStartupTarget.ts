import type { TelegramBindingRecord } from '../database/telegramBindingRepository';
import type { TelegramBotLike } from '../platform/telegram/wrappers';

/**
 * Candidate structure for determining Telegram startup channels/chats.
 */
interface StartupChatCandidate {
    /** Raw binding chat identifier. */
    bindingChatId: string;
    /** Resolved base chat identifier. */
    resolvedChatId: string;
    /** Chat type (e.g. group, supergroup, private). */
    type: string;
    /** Friendly display title or name. */
    title: string;
    /** Whether it corresponds directly to a top-level binding. */
    isDirectBinding: boolean;
}

/**
 * Strips sub-channel qualifiers from a compound chat ID.
 * @param chatId Target chat ID.
 * @returns Base chat ID.
 */
function getBaseChatId(chatId: string): string {
    const sepIdx = chatId.indexOf('_');
    return sepIdx > 0 ? chatId.slice(0, sepIdx) : chatId;
}

/**
 * Normalizes chat titles for consistency.
 * @param title Chat title.
 * @returns Normalized title string.
 */
function normalizeTitle(title: string): string {
    return title.trim().replace(/^#/, '').toLowerCase();
}

/**
 * Evaluates whether a chat title represents a general chat.
 * @param title Chat title.
 * @returns True if title matches 'general'.
 */
function isGeneralChat(title: string): boolean {
    return normalizeTitle(title) === 'general';
}

/**
 * Resolves the primary chat ID target to emit initial startup greeting message options.
 * @param api Telegram bot api client instance.
 * @param bindings Registered Telegram bindings lists.
 * @returns Selected chat ID string, or null if none resolved.
 */
export async function selectTelegramStartupChatId(
    api: TelegramBotLike['api'],
    bindings: TelegramBindingRecord[],
): Promise<string | null> {
    const candidates: StartupChatCandidate[] = [];
    const seenResolvedIds = new Set<string>();

    for (const binding of bindings) {
        const resolvedChatId = getBaseChatId(binding.chatId);
        if (seenResolvedIds.has(resolvedChatId)) continue;
        seenResolvedIds.add(resolvedChatId);

        try {
            const chat = await api.getChat(resolvedChatId);
            candidates.push({
                bindingChatId: binding.chatId,
                resolvedChatId,
                type: String(chat?.type ?? ''),
                title: String(chat?.title ?? chat?.first_name ?? ''),
                isDirectBinding: binding.chatId === resolvedChatId,
            });
        } catch {
            candidates.push({
                bindingChatId: binding.chatId,
                resolvedChatId,
                type: '',
                title: '',
                isDirectBinding: binding.chatId === resolvedChatId,
            });
        }
    }

    if (candidates.length === 0) return null;

    const generalGroup = candidates.find((candidate) =>
        candidate.type !== 'private' && isGeneralChat(candidate.title),
    );
    if (generalGroup) return generalGroup.resolvedChatId;

    const directGroup = candidates.find((candidate) =>
        candidate.type !== 'private' && candidate.isDirectBinding,
    );
    if (directGroup) return directGroup.resolvedChatId;

    const privateChat = candidates.find((candidate) => candidate.type === 'private');
    if (privateChat) return privateChat.bindingChatId;

    return candidates[0].resolvedChatId;
}
