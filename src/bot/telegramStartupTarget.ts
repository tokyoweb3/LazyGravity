import type { TelegramBindingRecord } from '../database/telegramBindingRepository';
import type { TelegramBotLike } from '../platform/telegram/wrappers';

interface StartupChatCandidate {
    bindingChatId: string;
    resolvedChatId: string;
    type: string;
    title: string;
    isDirectBinding: boolean;
}

function getBaseChatId(chatId: string): string {
    const sepIdx = chatId.indexOf('_');
    return sepIdx > 0 ? chatId.slice(0, sepIdx) : chatId;
}

function normalizeTitle(title: string): string {
    return title.trim().replace(/^#/, '').toLowerCase();
}

function isGeneralChat(title: string): boolean {
    return normalizeTitle(title) === 'general';
}

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
