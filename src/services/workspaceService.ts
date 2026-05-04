import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveSafePath } from '../middleware/sanitize';

/**
 * Service for workspace filesystem operations and path validation.
 * Manages directories under WORKSPACE_BASE_DIR.
 */
export class WorkspaceService {
    private readonly baseDir: string;

    constructor(baseDir: string) {
        this.baseDir = baseDir;
    }

    /**
     * Ensure the base directory exists, creating it if necessary
     */
    public ensureBaseDir(): void {
        if (!fs.existsSync(this.baseDir)) {
            fs.mkdirSync(this.baseDir, { recursive: true });
        }
    }

    /**
     * Return a list of subdirectories in the base directory
     */
    public scanWorkspaces(): string[] {
        this.ensureBaseDir();

        const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
            .map((entry) => entry.name)
            .sort();
    }

    /**
     * Validate a relative path and return a safe absolute path
     * @throws On path traversal detection
     */
    public validatePath(relativePath: string): string {
        // Skip validation for remote URIs
        if (relativePath.includes('://')) {
            return relativePath;
        }

        // Support absolute paths and home dir expansion
        if (relativePath.startsWith('/') || relativePath.startsWith('~')) {
            const expanded = relativePath.startsWith('~')
                ? path.join(os.homedir(), relativePath.slice(1))
                : path.resolve(relativePath);
            return expanded;
        }

        return resolveSafePath(relativePath, this.baseDir);
    }

    /**
     * Get the base directory path
     */
    public getBaseDir(): string {
        return this.baseDir;
    }

    /**
     * Return the absolute path of the specified workspace
     */
    public getWorkspacePath(workspaceName: string): string {
        return this.validatePath(workspaceName);
    }


    /**
     * Check if the specified workspace exists
     */
    public exists(workspaceName: string): boolean {
        const fullPath = this.validatePath(workspaceName);
        return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
    }
}
