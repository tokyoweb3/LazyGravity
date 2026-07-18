/**
 * Artifact Service — reads Antigravity artifacts from the local filesystem.
 *
 * Antigravity persists artifacts (implementation plans, tasks, walkthroughs)
 * as Markdown files with companion `.metadata.json` files in:
 *   %USERPROFILE%/.gemini/antigravity/brain/<conversation-id>/
 *
 * This service locates relevant conversations and surfaces their artifacts
 * for the /artifacts Discord command.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Valid artifact markdown document types enum. */
export type ArtifactType =
    | 'ARTIFACT_TYPE_IMPLEMENTATION_PLAN'
    | 'ARTIFACT_TYPE_TASK'
    | 'ARTIFACT_TYPE_WALKTHROUGH'
    | 'ARTIFACT_TYPE_OTHER'
    | string;

/**
 * Representation of the companion `.metadata.json` properties.
 */
export interface ArtifactMetadata {
    /** Artifact category type. */
    artifactType: ArtifactType;
    /** Summary description text. */
    summary?: string;
    /** Last updated ISO timestamp string. */
    updatedAt?: string;
    /** Current version of the artifact. */
    version?: string;
    /** Feedback requests modal trigger check. */
    requestFeedback?: boolean;
}

/**
 * Combined details mapping a located artifact's metadata and absolute path.
 */
export interface ArtifactInfo {
    /** The conversation UUID this artifact belongs to */
    conversationId: string;
    /** Filename of the artifact (e.g. "implementation_plan.md") */
    filename: string;
    /** Artifact type from metadata */
    artifactType: ArtifactType;
    /** Short summary from metadata */
    summary?: string;
    /** ISO timestamp of last update */
    updatedAt?: string;
    /** Display version number */
    version?: string;
    /** Full absolute path to the markdown file */
    absolutePath: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ARTIFACT_TYPE_LABELS: Record<string, string> = {
    ARTIFACT_TYPE_IMPLEMENTATION_PLAN: '📋 Plan',
    ARTIFACT_TYPE_TASK: '✅ Task',
    ARTIFACT_TYPE_WALKTHROUGH: '🚶 Walkthrough',
    ARTIFACT_TYPE_OTHER: '📄 Other',
};

/**
 * Maps artifact type identifier keys to localized/emoji labels.
 * @param type Target artifact type.
 * @returns Human-readable label string.
 */
export function artifactTypeLabel(type: ArtifactType): string {
    return ARTIFACT_TYPE_LABELS[type] ?? '📄 Artifact';
}

// ---------------------------------------------------------------------------
// ArtifactService
// ---------------------------------------------------------------------------

/** Common words to ignore when scoring fuzzy title matches */
const COMMON_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that']);

/**
 * Local file reader service scanning Antigravity workspace artifact directories.
 */
export class ArtifactService {
    private readonly brainBasePath: string;

    /**
     * @param brainBasePath Optional base directory override.
     */
    constructor(brainBasePath?: string) {
        if (brainBasePath) {
            this.brainBasePath = brainBasePath;
        } else {
            const idePath = path.join(os.homedir(), '.gemini', 'antigravity-ide', 'brain');
            const defaultPath = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
            this.brainBasePath = fs.existsSync(idePath) ? idePath : defaultPath;
        }
    }

    /**
     * Gets the active base directory path.
     * @returns Base path string.
     */
    public getBrainBasePath(): string {
        return this.brainBasePath;
    }

    /**
     * List all conversations in the brain directory (UUIDs).
     * @returns Array of conversation UUID strings.
     */
    private listConversationIds(): string[] {
        try {
            if (!fs.existsSync(this.brainBasePath)) return [];
            return fs.readdirSync(this.brainBasePath).filter((entry) => {
                const full = path.join(this.brainBasePath, entry);
                return (
                    fs.statSync(full).isDirectory() &&
                    /^[0-9a-f-]{36}$/.test(entry)
                );
            });
        } catch (err) {
            logger.warn(`[ArtifactService] Failed to list brain directory: ${err}`);
            return [];
        }
    }

    /**
     * Read the .metadata.json file for a given artifact in a conversation.
     * @param conversationId Conversation UUID.
     * @param mdFilename Artifact target markdown filename.
     * @returns Loaded metadata details, or null.
     */
    private readMetadata(
        conversationId: string,
        mdFilename: string,
    ): ArtifactMetadata | null {
        const metaPath = path.join(
            this.brainBasePath,
            conversationId,
            `${mdFilename}.metadata.json`,
        );
        try {
            if (!fs.existsSync(metaPath)) return null;
            const raw = fs.readFileSync(metaPath, 'utf-8');
            return JSON.parse(raw) as ArtifactMetadata;
        } catch {
            return null;
        }
    }

    /**
     * List all artifacts in a given conversation directory.
     * An artifact must be a .md file with a companion .metadata.json.
     * @param conversationId Conversation UUID.
     * @returns ArtifactInfo objects list.
     */
    listArtifacts(conversationId: string): ArtifactInfo[] {
        const convDir = path.join(this.brainBasePath, conversationId);
        try {
            if (!fs.existsSync(convDir)) return [];
            const entries = fs.readdirSync(convDir);
            const artifacts: ArtifactInfo[] = [];

            for (const entry of entries) {
                // Only look at .md files (not .metadata.json, .resolved, etc.)
                if (!entry.endsWith('.md')) continue;

                const meta = this.readMetadata(conversationId, entry);
                if (!meta) continue; // Not a tracked artifact — skip

                artifacts.push({
                    conversationId,
                    filename: entry,
                    artifactType: meta.artifactType ?? 'ARTIFACT_TYPE_OTHER',
                    summary: meta.summary,
                    updatedAt: meta.updatedAt,
                    version: meta.version,
                    absolutePath: path.join(convDir, entry),
                });
            }

            // Sort by updatedAt descending (most recent first)
            artifacts.sort((a, b) => {
                const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
                const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
                return tb - ta;
            });

            return artifacts;
        } catch (err) {
            logger.warn(
                `[ArtifactService] Failed to list artifacts for ${conversationId}: ${err}`,
            );
            return [];
        }
    }

    /**
     * Try to find a conversation UUID whose transcript or overview contains the given session title.
     * Uses an exact match first, falling back to keyword overlap scoring.
     * If workspaceFilter is provided, restricts matching exclusively to conversations belonging to that workspace.
     * Returns the UUID or null if not found.
     * @param title Chat session title needle.
     * @param workspaceFilter Optional workspace name filter.
     * @returns Matching conversation ID or null.
     */
    findConversationByTitle(title: string, workspaceFilter?: string): string | null {
        if (!title || !title.trim()) return null;
        const needle = title.trim().toLowerCase();
        const ids = this.listConversationIds();

        // Sort by directory mtime descending (most recent first)
        const sortedIds = ids
            .map((id) => {
                const full = path.join(this.brainBasePath, id);
                try {
                    return { id, mtime: fs.statSync(full).mtimeMs };
                } catch {
                    return { id, mtime: 0 };
                }
            })
            .sort((a, b) => b.mtime - a.mtime)
            .map(x => x.id);

        let bestId: string | null = null;
        let bestScore = 0;

        // Unicode-aware split to support CJK. Preserve CJK characters (len 1) but filter short Latin words.
        const cleanNeedleWords = needle
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .split(/\s+/)
            .filter(w => {
                if (COMMON_WORDS.has(w)) return false;
                // Allow CJK characters (Scripts: Han, Hiragana, Katakana, Hangul) even if length 1.
                const isCJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(w);
                return isCJK || w.length > 2;
            });
            
        const uniqueNeedleWords = Array.from(new Set(cleanNeedleWords));
        
        // Require a stronger minimum score of 2 to prevent weak one-word matches.
        const minScore = 2;
        const filterStr = workspaceFilter ? workspaceFilter.toLowerCase() : null;

        for (const id of sortedIds) {
            let score = 0;
            let exactMatch = false;
            let belongsToWorkspace = !filterStr; // True if no filter, or if we prove it belongs

            const scanFile = (filePath: string, readSize: number) => {
                try {
                    if (!fs.existsSync(filePath)) return;
                    let fd = null;
                    try {
                        fd = fs.openSync(filePath, 'r');
                        const buf = Buffer.alloc(readSize);
                        const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
                        const content = buf.slice(0, bytesRead).toString('utf-8').toLowerCase();
                        
                        if (filterStr) {
                            const escapedFilter = filterStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            const regex = new RegExp(`(?:file:\\/\\/\\/[^"\\)]*?\\/|[a-zA-Z]:[\\\\/](?!.*(?:\\.gemini|brain|antigravity))[^"\\)]*?[\\\\/])${escapedFilter}\\b`, 'i');
                            if (regex.test(content)) {
                                belongsToWorkspace = true;
                            }
                        }
                        
                        if (content.includes(needle)) {
                            exactMatch = true;
                        } else {
                            const contentTokens = new Set(content.replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/));
                            let currentScore = 0;
                            for (const word of uniqueNeedleWords) {
                                if (contentTokens.has(word)) currentScore++;
                            }
                            if (currentScore > score) score = currentScore;
                        }
                    } finally {
                        if (fd !== null) fs.closeSync(fd);
                    }
                } catch { /* ignore */ }
            };

            // 1. Check transcript.jsonl (modern)
            scanFile(path.join(this.brainBasePath, id, '.system_generated', 'logs', 'transcript.jsonl'), 16384);

            // 2. Check overview.txt (legacy)
            scanFile(path.join(this.brainBasePath, id, '.system_generated', 'logs', 'overview.txt'), 4096);

            if (!belongsToWorkspace) continue;
            
            if (exactMatch) return id; // Exact match in the right workspace takes precedence immediately

            if (score > bestScore) {
                bestScore = score;
                bestId = id;
            }
        }

        if (bestScore >= minScore) {
            return bestId;
        }

        return null;
    }

    /**
     * Return the conversation ID of the most recently modified conversation
     * that has at least one artifact. Falls back to the most recent conversation
     * overall if none have artifacts.
     * @param workspaceFilter Optional workspace directory name filter.
     * @returns Conversation UUID, or null.
     */
    getLatestConversationWithArtifacts(workspaceFilter?: string): string | null {
        const ids = this.listConversationIds();
        if (ids.length === 0) return null;

        const filterStr = workspaceFilter ? workspaceFilter.toLowerCase() : null;

        // Sort by directory mtime descending
        const sorted = ids
            .map((id) => {
                const full = path.join(this.brainBasePath, id);
                try {
                    return { id, mtime: fs.statSync(full).mtimeMs };
                } catch {
                    return { id, mtime: 0 };
                }
            })
            .sort((a, b) => b.mtime - a.mtime);

        if (filterStr) {
            const escapedFilter = filterStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const workspaceIds = sorted.filter(({ id }) => {
                let belongs = false;
                const regex = new RegExp(`(?:file:\\/\\/\\/[^"\\)]*?\\/|[a-zA-Z]:[\\\\/](?!.*(?:\\.gemini|brain|antigravity))[^"\\)]*?[\\\\/])${escapedFilter}\\b`, 'i');
                const checkFile = (filePath: string) => {
                    try {
                        if (fs.existsSync(filePath)) {
                            const content = fs.readFileSync(filePath, 'utf-8').toLowerCase();
                            if (regex.test(content)) {
                                belongs = true;
                            }
                        }
                    } catch { /* ignore */ }
                };
                
                checkFile(path.join(this.brainBasePath, id, '.system_generated', 'logs', 'transcript.jsonl'));
                if (!belongs) {
                    checkFile(path.join(this.brainBasePath, id, 'implementation_plan.md'));
                }
                return belongs;
            });

            if (workspaceIds.length === 0) return null;

            const latestId = workspaceIds[0].id;
            if (this.listArtifacts(latestId).length > 0) {
                return latestId;
            }
            return null;
        }

        // Original fallback behavior for no filter
        for (const { id } of sorted) {
            if (this.listArtifacts(id).length > 0) return id;
        }

        return sorted[0]?.id ?? null;
    }

    /**
     * Build the filesystem path for a specific artifact file.
     * @param conversationId Conversation UUID.
     * @param filename Target filename.
     * @returns Absolute path to target artifact file.
     */
    getArtifactPath(conversationId: string, filename: string): string {
        const safe = path.basename(filename);
        return path.join(this.brainBasePath, conversationId, safe);
    }

    /**
     * Read the markdown content of a specific artifact file.
     * Returns null if the file cannot be read.
     * @param conversationId Conversation UUID.
     * @param filename Target filename.
     * @returns Content string, or null.
     */
    getArtifactContent(conversationId: string, filename: string): string | null {
        // Sanitize: prevent path traversal
        const safe = path.basename(filename);
        if (!safe.endsWith('.md')) return null;

        const filePath = path.join(this.brainBasePath, conversationId, safe);
        try {
            if (!fs.existsSync(filePath)) return null;
            return fs.readFileSync(filePath, 'utf-8');
        } catch (err) {
            logger.warn(
                `[ArtifactService] Failed to read artifact ${conversationId}/${safe}: ${err}`,
            );
            return null;
        }
    }

    /**
     * Encode conversationId and filename into a single string for Discord select menu values.
     * We use a prefix 'art_', followed by a short slice of the conv ID, and the filename.
     * Added a short hash of the filename to prevent collisions on long-filename truncation.
     * @param conversationId Conversation UUID.
     * @param filename Target filename.
     * @returns Encoded select value string.
     */
    static encodeSelectValue(conversationId: string, filename: string): string {
        const shortConv = conversationId.replace(/-/g, '').slice(0, 12);
        // Simple hash of the filename
        let hash = 0;
        for (let i = 0; i < filename.length; i++) {
            hash = ((hash << 5) - hash) + filename.charCodeAt(i);
            hash |= 0; // Convert to 32bit integer
        }
        const shortHash = Math.abs(hash).toString(36).slice(0, 4);
        
        return `art_${shortConv}_${shortHash}_${filename}`;
    }

    /**
     * Decode a select menu value back into conversationId and filename.
     * Since we only have a slice of the conversationId, we must look it up
     * in the provided list of artifacts.
     * @param value Encoded select value string.
     * @param artifacts Current artifacts options.
     * @returns Decoded conversationId and filename payload, or null.
     */
    decodeSelectValue(value: string, artifacts: ArtifactInfo[]): { conversationId: string; filename: string } | null {
        if (!value.startsWith('art_')) return null;
        
        // Format: art_CONV_HASH_FILENAME
        const parts = value.split('_');
        if (parts.length < 4) return null;
        
        const shortConv = parts[1];
        const filename = parts.slice(3).join('_'); // Filename might contain underscores

        // Find the matching artifact in the current list
        const found = artifacts.find(a => 
            a.filename === filename && 
            a.conversationId.replace(/-/g, '').startsWith(shortConv)
        );

        return found ? { conversationId: found.conversationId, filename: found.filename } : null;
    }
}
