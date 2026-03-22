import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';

interface CockpitInstancesFile {
    instances?: Array<{
        name?: unknown;
        userDataDir?: unknown;
    }>;
}

export interface AntigravityProfilePaths {
    profileName: string;
    userDataDir: string;
    globalStateDbPath: string;
}

export interface ConversationTransferBundle {
    conversationId: string;
    title: string;
    sourceProfile: string;
    exportedAt: string;
    trajectoryEntryBase64: string;
    files: {
        conversationPb?: string;
        annotationsPbtxt?: string;
        brainDir?: string;
    };
}

export interface ConversationTransferResult {
    conversationId: string;
    bundleDir: string;
    dbBackupPath: string;
}

export interface WaitForConversationPersistenceOptions {
    timeoutMs?: number;
    pollIntervalMs?: number;
}

export interface TrajectorySummaryEntry {
    conversationId: string;
    title: string;
    outerEntryBytes: Buffer;
    rawDataBase64: string;
}

const TRAJECTORY_SUMMARIES_KEY = 'antigravityUnifiedStateSync.trajectorySummaries';

function homeDir(): string {
    return process.env.LAZY_GRAVITY_TEST_HOME || os.homedir();
}

function encodeVarint(value: number): Buffer {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`Cannot encode invalid varint value: ${value}`);
    }

    const bytes: number[] = [];
    let remaining = value >>> 0;

    while (remaining >= 0x80) {
        bytes.push((remaining & 0x7f) | 0x80);
        remaining >>>= 7;
    }

    bytes.push(remaining);
    return Buffer.from(bytes);
}

function encodeLengthDelimited(fieldNumber: number, payload: Buffer): Buffer {
    const tag = encodeVarint((fieldNumber << 3) | 2);
    const length = encodeVarint(payload.length);
    return Buffer.concat([tag, length, payload]);
}

function readVarint(buffer: Buffer, offset: number): [number, number] {
    let result = 0;
    let shift = 0;
    let cursor = offset;

    while (cursor < buffer.length) {
        const byte = buffer[cursor];
        result |= (byte & 0x7f) << shift;
        cursor += 1;

        if ((byte & 0x80) === 0) {
            return [result, cursor];
        }

        shift += 7;
    }

    throw new Error('Unexpected EOF while reading protobuf varint');
}

function looksLikeBase64Text(payload: Buffer): boolean {
    if (payload.length === 0) {
        return false;
    }

    const text = payload.toString('utf8').trim();
    if (text.length === 0 || text.length % 4 !== 0) {
        return false;
    }

    return /^[A-Za-z0-9+/=]+$/.test(text);
}

function decodeTrajectoryInnerTitleFromBuffer(innerBuffer: Buffer): string {
    function skipField(offset: number, wireType: number): number {
        if (wireType === 0) {
            const [, afterValue] = readVarint(innerBuffer, offset);
            return afterValue;
        }

        if (wireType === 1) {
            return offset + 8;
        }

        if (wireType === 2) {
            const [length, afterLength] = readVarint(innerBuffer, offset);
            return afterLength + length;
        }

        if (wireType === 3) {
            let cursor = offset;
            while (cursor < innerBuffer.length) {
                const [groupTag, afterGroupTag] = readVarint(innerBuffer, cursor);
                cursor = afterGroupTag;
                const groupWire = groupTag & 7;
                if (groupWire === 4) {
                    return cursor;
                }
                cursor = skipField(cursor, groupWire);
            }
            return cursor;
        }

        if (wireType === 5) {
            return offset + 4;
        }

        if (wireType === 4) {
            return offset;
        }

        throw new Error(`Unsupported wire type ${wireType} while decoding trajectory title`);
    }

    let offset = 0;
    while (offset < innerBuffer.length) {
        const [tag, afterTag] = readVarint(innerBuffer, offset);
        offset = afterTag;
        const fieldNumber = tag >> 3;
        const wireType = tag & 7;

        if (wireType === 2) {
            const [length, afterLength] = readVarint(innerBuffer, offset);
            offset = afterLength;
            const payload = innerBuffer.subarray(offset, offset + length);
            offset += length;

            if (fieldNumber === 1) {
                return payload.toString('utf8');
            }
            continue;
        }

        offset = skipField(offset, wireType);
    }

    return '';
}

function unwrapNestedTrajectoryTitle(title: string, depth: number = 0): string {
    if (depth >= 3) {
        return title;
    }

    const buffer = Buffer.from(title, 'utf8');
    if (!looksLikeBase64Text(buffer)) {
        return title;
    }

    try {
        const nestedTitle = decodeTrajectoryInnerTitleFromBuffer(Buffer.from(title, 'base64'));
        if (!nestedTitle) {
            return title;
        }
        return unwrapNestedTrajectoryTitle(nestedTitle, depth + 1);
    } catch {
        return title;
    }
}

function decodeTrajectoryInnerTitle(payload: Buffer): string {
    const candidates: Buffer[] = [payload];
    if (looksLikeBase64Text(payload)) {
        try {
            candidates.unshift(Buffer.from(payload.toString('utf8'), 'base64'));
        } catch {
            // Ignore invalid base64 decode and fall back to the raw payload.
        }
    }

    for (const candidate of candidates) {
        try {
            const title = decodeTrajectoryInnerTitleFromBuffer(candidate);
            if (title) {
                return unwrapNestedTrajectoryTitle(title);
            }
        } catch {
            // Continue through the candidate list. Mixed profile formats are tolerated.
        }
    }

    return '';
}

export function parseTrajectorySummariesBase64(value: string): TrajectorySummaryEntry[] {
    const decoded = Buffer.from(value, 'base64');
    const entries: TrajectorySummaryEntry[] = [];
    let offset = 0;

    while (offset < decoded.length) {
        const entryStart = offset;
        const [tag, afterTag] = readVarint(decoded, offset);
        offset = afterTag;

        const fieldNumber = tag >> 3;
        const wireType = tag & 7;

        if (fieldNumber !== 1 || wireType !== 2) {
            throw new Error(`Unexpected trajectory summaries top-level field ${fieldNumber} wire ${wireType}`);
        }

        const [entryLength, afterLength] = readVarint(decoded, offset);
        offset = afterLength;
        const entryPayload = decoded.subarray(offset, offset + entryLength);
        const outerEntryBytes = decoded.subarray(entryStart, offset + entryLength);
        offset += entryLength;

        let entryOffset = 0;
        let conversationId = '';
        let rawDataBytes = Buffer.alloc(0);

        while (entryOffset < entryPayload.length) {
            const [entryTag, afterEntryTag] = readVarint(entryPayload, entryOffset);
            entryOffset = afterEntryTag;
            const entryField = entryTag >> 3;
            const entryWire = entryTag & 7;

            if (entryWire !== 2) {
                throw new Error(`Unexpected trajectory entry field wire type ${entryWire}`);
            }

            const [entryValueLength, afterEntryLength] = readVarint(entryPayload, entryOffset);
            entryOffset = afterEntryLength;
            const entryValue = entryPayload.subarray(entryOffset, entryOffset + entryValueLength);
            entryOffset += entryValueLength;

            if (entryField === 1) {
                conversationId = entryValue.toString('utf8');
            } else if (entryField === 2) {
                rawDataBytes = Buffer.from(entryValue);
            }
        }

        if (!conversationId || rawDataBytes.length === 0) {
            continue;
        }

        entries.push({
            conversationId,
            title: decodeTrajectoryInnerTitle(rawDataBytes),
            outerEntryBytes: Buffer.from(outerEntryBytes),
            rawDataBase64: rawDataBytes.toString('base64'),
        });
    }

    return entries;
}

function normalizeProfileName(name: string): string {
    return name.trim().toLowerCase();
}

function defaultAntigravityUserDataDir(): string {
    const home = homeDir();
    if (process.platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'Antigravity');
    }
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
        return path.join(appData, 'Antigravity');
    }
    return path.join(home, '.config', 'Antigravity');
}

export function resolveAntigravityProfilePaths(profileName: string): AntigravityProfilePaths {
    const normalized = normalizeProfileName(profileName);
    const defaultDir = defaultAntigravityUserDataDir();

    if (normalized === 'default') {
        return {
            profileName: 'default',
            userDataDir: defaultDir,
            globalStateDbPath: path.join(defaultDir, 'User', 'globalStorage', 'state.vscdb'),
        };
    }

    const instancesPath = path.join(homeDir(), '.antigravity_cockpit', 'instances.json');
    if (!fs.existsSync(instancesPath)) {
        throw new Error(`Could not resolve profile "${profileName}" because ${instancesPath} does not exist`);
    }

    const parsed = JSON.parse(fs.readFileSync(instancesPath, 'utf8')) as CockpitInstancesFile;
    const instances = Array.isArray(parsed.instances) ? parsed.instances : [];
    const match = instances.find((instance) => {
        const instanceName = typeof instance.name === 'string' ? normalizeProfileName(instance.name) : '';
        return instanceName === normalized;
    });

    if (!match || typeof match.userDataDir !== 'string' || match.userDataDir.trim().length === 0) {
        throw new Error(`Could not find Antigravity profile "${profileName}" in ${instancesPath}`);
    }

    const userDataDir = match.userDataDir.trim();
    return {
        profileName: normalized,
        userDataDir,
        globalStateDbPath: path.join(userDataDir, 'User', 'globalStorage', 'state.vscdb'),
    };
}

function antigravitySharedRoot(): string {
    return path.join(homeDir(), '.gemini', 'antigravity');
}

function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

function copyIfExists(sourcePath: string, targetPath: string): boolean {
    if (!fs.existsSync(sourcePath)) {
        return false;
    }

    if (fs.existsSync(targetPath)) {
        return true;
    }

    ensureDir(path.dirname(targetPath));
    fs.cpSync(sourcePath, targetPath, { recursive: true });
    return true;
}

function writeConversationBundle(
    bundleDir: string,
    profileName: string,
    entry: TrajectorySummaryEntry,
): void {
    ensureDir(bundleDir);

    const sharedRoot = antigravitySharedRoot();
    const relativeFiles = {
        conversationPb: path.join('conversations', `${entry.conversationId}.pb`),
        annotationsPbtxt: path.join('annotations', `${entry.conversationId}.pbtxt`),
        brainDir: path.join('brain', entry.conversationId),
    };

    const manifest: ConversationTransferBundle = {
        conversationId: entry.conversationId,
        title: entry.title,
        sourceProfile: profileName,
        exportedAt: new Date().toISOString(),
        trajectoryEntryBase64: entry.outerEntryBytes.toString('base64'),
        files: {},
    };

    if (copyIfExists(path.join(sharedRoot, relativeFiles.conversationPb), path.join(bundleDir, relativeFiles.conversationPb))) {
        manifest.files.conversationPb = relativeFiles.conversationPb;
    }
    if (copyIfExists(path.join(sharedRoot, relativeFiles.annotationsPbtxt), path.join(bundleDir, relativeFiles.annotationsPbtxt))) {
        manifest.files.annotationsPbtxt = relativeFiles.annotationsPbtxt;
    }
    if (copyIfExists(path.join(sharedRoot, relativeFiles.brainDir), path.join(bundleDir, relativeFiles.brainDir))) {
        manifest.files.brainDir = relativeFiles.brainDir;
    }

    fs.writeFileSync(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

function loadTrajectorySummaries(dbPath: string): { db: Database.Database; value: string; entries: TrajectorySummaryEntry[] } {
    if (!fs.existsSync(dbPath)) {
        throw new Error(`Global state DB not found: ${dbPath}`);
    }

    const db = new Database(dbPath);
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(TRAJECTORY_SUMMARIES_KEY) as { value?: Buffer | string } | undefined;
    const value = row?.value ? String(row.value) : '';
    const entries = value ? parseTrajectorySummariesBase64(value) : [];
    return { db, value, entries };
}

export function findTrajectoryEntriesByTitle(profileName: string, title: string): TrajectorySummaryEntry[] {
    const profile = resolveAntigravityProfilePaths(profileName);
    const { db, entries } = loadTrajectorySummaries(profile.globalStateDbPath);
    try {
        return entries.filter((entry) => entry.title === title);
    } finally {
        db.close();
    }
}

export function findLatestTrajectoryEntryByTitle(
    profileName: string,
    title: string,
): TrajectorySummaryEntry | undefined {
    const matches = findTrajectoryEntriesByTitle(profileName, title);
    return matches.length > 0 ? matches[matches.length - 1] : undefined;
}

export function findTrajectoryEntryByConversationId(
    profileName: string,
    conversationId: string,
): TrajectorySummaryEntry | undefined {
    const profile = resolveAntigravityProfilePaths(profileName);
    const { db, entries } = loadTrajectorySummaries(profile.globalStateDbPath);
    try {
        return entries.find((entry) => entry.conversationId === conversationId);
    } finally {
        db.close();
    }
}

export async function waitForConversationPersistence(
    profileName: string,
    title: string,
    options: WaitForConversationPersistenceOptions = {},
): Promise<TrajectorySummaryEntry> {
    const timeoutMs = options.timeoutMs ?? 15000;
    const pollIntervalMs = options.pollIntervalMs ?? 500;
    const profile = resolveAntigravityProfilePaths(profileName);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
        const { db, entries } = loadTrajectorySummaries(profile.globalStateDbPath);
        try {
            const matches = entries.filter((entry) => entry.title === title);
            const matched = matches.length > 0 ? matches[matches.length - 1] : undefined;
            if (matched) {
                return matched;
            }
        } finally {
            db.close();
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(
        `Conversation titled "${title}" is not persisted in Antigravity history for profile "${profile.profileName}" yet.`,
    );
}

export async function waitForConversationPersistenceByConversationId(
    profileName: string,
    conversationId: string,
    options: WaitForConversationPersistenceOptions = {},
): Promise<TrajectorySummaryEntry> {
    const timeoutMs = options.timeoutMs ?? 15000;
    const pollIntervalMs = options.pollIntervalMs ?? 500;
    const profile = resolveAntigravityProfilePaths(profileName);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
        const { db, entries } = loadTrajectorySummaries(profile.globalStateDbPath);
        try {
            const matched = entries.find((entry) => entry.conversationId === conversationId);
            if (matched) {
                return matched;
            }
        } finally {
            db.close();
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(
        `Conversation ID "${conversationId}" is not persisted in Antigravity history for profile "${profile.profileName}" yet.`,
    );
}

export function exportConversationBundleByTitle(profileName: string, title: string, outputDir: string): string {
    const profile = resolveAntigravityProfilePaths(profileName);
    const { db, entries } = loadTrajectorySummaries(profile.globalStateDbPath);

    try {
        const matches = entries.filter((entry) => entry.title === title);
        const matched = matches.length > 0 ? matches[matches.length - 1] : undefined;
        if (!matched) {
            throw new Error(`Conversation titled "${title}" was not found in profile "${profile.profileName}" trajectory summaries`);
        }

        const bundleDir = path.join(outputDir, matched.conversationId);
        writeConversationBundle(bundleDir, profile.profileName, matched);
        return bundleDir;
    } finally {
        db.close();
    }
}

export function exportConversationBundleByConversationId(
    profileName: string,
    conversationId: string,
    outputDir: string,
): string {
    const profile = resolveAntigravityProfilePaths(profileName);
    const { db, entries } = loadTrajectorySummaries(profile.globalStateDbPath);

    try {
        const matched = entries.find((entry) => entry.conversationId === conversationId);
        if (!matched) {
            throw new Error(
                `Conversation ID "${conversationId}" was not found in profile "${profile.profileName}" trajectory summaries`,
            );
        }

        const bundleDir = path.join(outputDir, matched.conversationId);
        writeConversationBundle(bundleDir, profile.profileName, matched);
        return bundleDir;
    } finally {
        db.close();
    }
}

export function importConversationBundleToProfile(bundleDir: string, profileName: string): { conversationId: string; dbBackupPath: string } {
    const manifestPath = path.join(bundleDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`Bundle manifest not found: ${manifestPath}`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ConversationTransferBundle;
    const profile = resolveAntigravityProfilePaths(profileName);
    const sharedRoot = antigravitySharedRoot();

    if (manifest.files.conversationPb) {
        copyIfExists(path.join(bundleDir, manifest.files.conversationPb), path.join(sharedRoot, manifest.files.conversationPb));
    }
    if (manifest.files.annotationsPbtxt) {
        copyIfExists(path.join(bundleDir, manifest.files.annotationsPbtxt), path.join(sharedRoot, manifest.files.annotationsPbtxt));
    }
    if (manifest.files.brainDir) {
        copyIfExists(path.join(bundleDir, manifest.files.brainDir), path.join(sharedRoot, manifest.files.brainDir));
    }

    ensureDir(path.dirname(profile.globalStateDbPath));
    const dbBackupPath = `${profile.globalStateDbPath}.bak.${Date.now()}`;
    if (fs.existsSync(profile.globalStateDbPath)) {
        fs.copyFileSync(profile.globalStateDbPath, dbBackupPath);
    }

    const { db, value, entries } = loadTrajectorySummaries(profile.globalStateDbPath);
    try {
        const alreadyPresent = entries.some((entry) => entry.conversationId === manifest.conversationId);
        if (!alreadyPresent) {
            const currentBinary = value ? Buffer.from(value, 'base64') : Buffer.alloc(0);
            const appended = Buffer.concat([
                currentBinary,
                Buffer.from(manifest.trajectoryEntryBase64, 'base64'),
            ]);
            const updatedValue = appended.toString('base64');

            const upsert = db.prepare(`
                INSERT INTO ItemTable (key, value)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
            `);
            upsert.run(TRAJECTORY_SUMMARIES_KEY, updatedValue);
        }

        return {
            conversationId: manifest.conversationId,
            dbBackupPath,
        };
    } finally {
        db.close();
    }
}

export function transferConversationByTitle(
    sourceProfileName: string,
    targetProfileName: string,
    title: string,
): ConversationTransferResult {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lazy-gravity-conversation-transfer-'));

    try {
        const bundleDir = exportConversationBundleByTitle(sourceProfileName, title, tempRoot);
        const imported = importConversationBundleToProfile(bundleDir, targetProfileName);
        return {
            conversationId: imported.conversationId,
            bundleDir,
            dbBackupPath: imported.dbBackupPath,
        };
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

export function transferConversationByConversationId(
    sourceProfileName: string,
    targetProfileName: string,
    conversationId: string,
): ConversationTransferResult {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lazy-gravity-conversation-transfer-'));

    try {
        const bundleDir = exportConversationBundleByConversationId(sourceProfileName, conversationId, tempRoot);
        const imported = importConversationBundleToProfile(bundleDir, targetProfileName);
        return {
            conversationId: imported.conversationId,
            bundleDir,
            dbBackupPath: imported.dbBackupPath,
        };
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}
