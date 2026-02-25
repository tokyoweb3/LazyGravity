// =============================================================================
// Retry store — keeps retry info for the Retry button on errors
// Extracted to avoid circular dependency between bot/index.ts and
// interactionCreateHandler.ts.
// =============================================================================

export const RETRY_BTN_PREFIX = 'retry_prompt_';
const MAX_RETRY_STORE_SIZE = 100;

/** TTL for retry entries — matches Discord interaction token lifetime (15 min) */
const RETRY_TTL_MS = 15 * 60 * 1000;

export interface RetryInfo {
    /** 'resend' = prompt was never sent, re-inject it; 'click-retry' = prompt already sent, click Antigravity retry button */
    type: 'resend' | 'click-retry';
    /** Original prompt text (only used for 'resend') */
    prompt?: string;
    /** Timestamp when this entry was created (ms since epoch) */
    createdAt: number;
}

const retryStore = new Map<string, RetryInfo>();

/** Prune entries older than RETRY_TTL_MS */
function pruneExpired(): void {
    const now = Date.now();
    for (const [k, v] of retryStore) {
        if (now - v.createdAt > RETRY_TTL_MS) retryStore.delete(k);
    }
}

export function storeRetry(key: string, info: Omit<RetryInfo, 'createdAt'>): void {
    pruneExpired();
    if (retryStore.size >= MAX_RETRY_STORE_SIZE) {
        const firstKey = retryStore.keys().next().value;
        if (firstKey !== undefined) retryStore.delete(firstKey);
    }
    retryStore.set(key, { ...info, createdAt: Date.now() });
}

export function getRetryInfo(key: string): RetryInfo | undefined {
    const entry = retryStore.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.createdAt > RETRY_TTL_MS) {
        retryStore.delete(key);
        return undefined;
    }
    return entry;
}

export function deleteRetryInfo(key: string): void {
    retryStore.delete(key);
}
