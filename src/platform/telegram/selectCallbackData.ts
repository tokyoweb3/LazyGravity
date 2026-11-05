import { randomBytes } from 'crypto';

/** Separates a select menu's custom ID from its selected value in legacy callbacks. */
export const SELECT_CALLBACK_SEP = '\x1f';
const TOKEN_PREFIX = 'lgsel:';
const MAX_CALLBACK_BYTES = 64;
const MAX_ENTRIES = 10000;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Full select identity retained on the server when Telegram cannot carry it inline. */
interface SelectCallback {
    customId: string;
    value: string;
}

const callbacks = new Map<string, SelectCallback & { expiresAt: number }>();

/** Preserve short callbacks verbatim and replace oversized UTF-8 payloads with bounded, expiring tokens. */
export function encodeSelectCallback(customId: string, value: string): string {
    const inline = `${customId}${SELECT_CALLBACK_SEP}${value}`;
    if (Buffer.byteLength(inline, 'utf8') <= MAX_CALLBACK_BYTES) return inline;

    const now = Date.now();
    for (const [token, entry] of callbacks) {
        if (entry.expiresAt > now) break;
        callbacks.delete(token);
    }
    if (callbacks.size >= MAX_ENTRIES) callbacks.delete(callbacks.keys().next().value!);
    const token = TOKEN_PREFIX + randomBytes(16).toString('hex');
    callbacks.set(token, { customId, value, expiresAt: now + TOKEN_TTL_MS });
    return token;
}

/** Decode legacy or tokenized selections; fail closed for tokens lost after expiry, eviction, or restart. */
export function decodeSelectCallback(data: string): SelectCallback | 'expired' | null {
    if (data.startsWith(TOKEN_PREFIX)) {
        const entry = callbacks.get(data);
        if (!entry || entry.expiresAt <= Date.now()) {
            callbacks.delete(data);
            return 'expired';
        }
        return { customId: entry.customId, value: entry.value };
    }
    const separator = data.indexOf(SELECT_CALLBACK_SEP);
    return separator > 0 ? { customId: data.slice(0, separator), value: data.slice(separator + 1) } : null;
}
