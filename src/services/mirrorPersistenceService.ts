import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

export interface MirrorState {
    channelId: string;
    workspacePath: string;
    accountName: string | null;
}

export class MirrorPersistenceService {
    private readonly filePath: string;

    constructor(projectRoot: string) {
        this.filePath = path.join(projectRoot, '.mirror_state.json');
    }

    /** Save current active mirrors to file */
    save(states: MirrorState[]): void {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(states, null, 2), 'utf-8');
            logger.debug(`[MirrorPersistence] Saved ${states.length} active mirrors.`);
        } catch (error) {
            logger.warn('[MirrorPersistence] Failed to save mirror state:', error);
        }
    }

    /** Load active mirrors from file */
    load(): MirrorState[] {
        try {
            if (!fs.existsSync(this.filePath)) return [];
            const content = fs.readFileSync(this.filePath, 'utf-8');
            const states = JSON.parse(content);
            if (Array.isArray(states)) {
                return states;
            }
        } catch (error) {
            logger.warn('[MirrorPersistence] Failed to load mirror state:', error);
        }
        return [];
    }
}
