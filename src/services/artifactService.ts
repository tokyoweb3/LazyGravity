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

export type ArtifactType =
    | 'ARTIFACT_TYPE_IMPLEMENTATION_PLAN'
    | 'ARTIFACT_TYPE_TASK'
    | 'ARTIFACT_TYPE_WALKTHROUGH'
    | 'ARTIFACT_TYPE_OTHER'
    | string;

export interface ArtifactMetadata {
    artifactType: ArtifactType;
    summary?: string;
    updatedAt?: string;
    version?: string;
    requestFeedback?: boolean;
}

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

export function artifactTypeLabel(type: ArtifactType): string {
    return ARTIFACT_TYPE_LABELS[type] ?? '📄 Artifact';
}

// ---------------------------------------------------------------------------
// ArtifactService
// ---------------------------------------------------------------------------

export class ArtifactService {
    private readonly brainBasePath: string;

    constructor(brainBasePath?: string) {
        this.brainBasePath =
            brainBasePath ??
            path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
    }

    /**
     * List all conversations in the brain directory (UUIDs).
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
     * Try to find a conversation UUID whose overview.txt contains the given session title.
     * Uses an exact match first, falling back to keyword overlap scoring.
     * Returns the UUID or null if not found.
     */
    findConversationByTitle(title: string): string | null {
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

        const commonWords = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'fixing', 'adding', 'updating', 'project']);
        const cleanNeedleWords = needle.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !commonWords.has(w));
        const uniqueNeedleWords = Array.from(new Set(cleanNeedleWords));
        
        // Require a stronger minimum score of 2 to prevent weak one-word matches.
        const minScore = 2;

        for (const id of sortedIds) {
            const overviewPath = path.join(
                this.brainBasePath,
                id,
                '.system_generated',
                'logs',
                'overview.txt',
            );
            try {
                if (!fs.existsSync(overviewPath)) continue;
                // Only read the first 4KB to avoid huge files
                let fd: number | null = null;
                try {
                    fd = fs.openSync(overviewPath, 'r');
                    const buf = Buffer.alloc(4096);
                    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
                    const header = buf.slice(0, bytesRead).toString('utf-8').toLowerCase();
                    
                    if (header.includes(needle)) {
                        return id; // Exact match takes precedence
                    }

                    const headerTokens = new Set(header.replace(/[^a-z0-9]/g, ' ').split(/\s+/));
                    
                    let score = 0;
                    for (const word of uniqueNeedleWords) {
                        if (headerTokens.has(word)) score++;
                    }
                    if (score > bestScore) {
                        bestScore = score;
                        bestId = id;
                    }
                } finally {
                    if (fd !== null) fs.closeSync(fd);
                }
            } catch {
                // Skip unreadable files
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
     */
    getLatestConversationWithArtifacts(): string | null {
        const ids = this.listConversationIds();
        if (ids.length === 0) return null;

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

        // Find the first one that has artifacts
        for (const { id } of sorted) {
            if (this.listArtifacts(id).length > 0) return id;
        }

        // Nothing has artifacts — return most recent anyway (caller handles empty list)
        return sorted[0]?.id ?? null;
    }

    /**
     * Read the markdown content of a specific artifact file.
     * Returns null if the file cannot be read.
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
