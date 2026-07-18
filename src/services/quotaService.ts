/**
 * Service to retrieve model usage quota information.
 * Communicates with the local language server process.
 */

import { logger } from '../utils/logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as https from 'https';

const execAsync = promisify(exec);

/**
 * Representation of remaining quota usage fraction and reset timestamp.
 */
export interface QuotaInfo {
    /** Fractional value of remaining quota (0.0 to 1.0). */
    remainingFraction: number;
    /** Date string of when the quota resets. */
    resetTime: string;
}

/**
 * Represents the quota configuration metadata for a specific AI model.
 */
export interface ModelQuota {
    /** The display name/label of the model. */
    label: string;
    /** The internal model key/identifier. */
    model: string;
    /** Optional quota details. */
    quotaInfo?: QuotaInfo;
}

/**
 * Payload structure of the user status response.
 */
export interface UserStatusData {
    /** List of model quotas for the client. */
    clientModelConfigs?: ModelQuota[];
}

/**
 * Service that connects to the local language server to check current AI usage limits.
 */
export class QuotaService {
    /** Cached TCP port of the active language server. */
    private cachedPort: number | null = null;
    /** Cached CSRF security token. */
    private cachedCsrfToken: string | null = null;
    /** Cached PID of the language server process. */
    private cachedPid: number | null = null;

    /**
     * Resolves the current language server process PID and CSRF token.
     * @returns Process details, or null if not found.
     */
    private async getUnixProcessInfo(): Promise<{pid: number, csrf_token: string} | null> {
        try {
            // macOS
            const { stdout } = await execAsync('pgrep -fl language_server');
            const lines = stdout.split('\n');
            for (const line of lines) {
                if (line.includes('--csrf_token')) {
                    const parts = line.trim().split(/\s+/);
                    const pid = parseInt(parts[0], 10);
                    const cmd = line.substring(parts[0].length).trim();
                    const tokenMatch = cmd.match(/--csrf_token[=\s]+([a-zA-Z0-9\-]+)/);
                    if (pid && tokenMatch && tokenMatch[1]) {
                        return { pid, csrf_token: tokenMatch[1] };
                    }
                }
            }
        } catch (e) {
            logger.error('Failed to get process info:', e);
        }
        return null;
    }

    /**
     * Finds active TCP ports the specified process ID is listening on.
     * @param pid Process ID.
     * @returns Array of active listening ports.
     */
    private async getListeningPorts(pid: number): Promise<number[]> {
        const ports: number[] = [];
        try {
            // macOS
            const { stdout } = await execAsync(`lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid}`);
            const regex = new RegExp(`^\\S+\\s+${pid}\\s+.*?(?:TCP|UDP)\\s+(?:\\*|[\\d.]+|\\[[\\da-f:]+\\]):(\\d+)\\s+\\(LISTEN\\)`, 'gim');
            let match;
            while ((match = regex.exec(stdout)) !== null) {
                const port = parseInt(match[1], 10);
                if (!ports.includes(port)) {
                    ports.push(port);
                }
            }
        } catch (e) {
            logger.error(`Failed to get ports for pid ${pid}:`, e);
        }
        return ports;
    }

    /**
     * Query the language server status HTTP RPC endpoint.
     * @param port Target localhost TCP port.
     * @param csrfToken CSRF token header value.
     * @returns UserStatusData payload.
     */
    private requestApi(port: number, csrfToken: string): Promise<UserStatusData> {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify({
                metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en' }
            });
            const options: https.RequestOptions = {
                hostname: '127.0.0.1',
                port: port,
                path: '/exa.language_server_pb.LanguageServerService/GetUserStatus',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                    'Connect-Protocol-Version': '1',
                    'X-Codeium-Csrf-Token': csrfToken,
                },
                rejectUnauthorized: false,
                timeout: 2000,
            };

            const req = https.request(options, res => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        return reject(new Error(`HTTP ${res.statusCode}`));
                    }
                    try {
                        const parsed = JSON.parse(body);
                        const cascadeData = parsed?.userStatus?.cascadeModelConfigData;
                        const rawConfigs: any[] = cascadeData?.clientModelConfigs || [];
                        const configs: ModelQuota[] = rawConfigs.map((c: any) => {
                            const label = c.label || c.displayName || c.modelName || c.model || '';
                            const model = c.model || c.modelId || '';
                            const qi = c.quotaInfo || c.quota || c.usageInfo;
                            const quotaInfo = qi ? {
                                remainingFraction: qi.remainingFraction ?? qi.remaining ?? 1,
                                resetTime: qi.resetTime || qi.resetAt || '',
                            } : undefined;
                            return { label, model, quotaInfo };
                        });
                        resolve({ clientModelConfigs: configs });
                    } catch (e) {
                        reject(new Error('Invalid JSON response'));
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.write(data);
            req.end();
        });
    }

    /**
     * Resolves process details, queries target ports, and fetches current quota usages.
     * @returns Array of ModelQuota configurations.
     */
    public async fetchQuota(): Promise<ModelQuota[]> {
        let processInfo = await this.getUnixProcessInfo();
        if (!processInfo) {
            logger.error('No language_server process found.');
            return [];
        }

        const { pid, csrf_token } = processInfo;

        // If PID or Token changed, invalidate cache
        if (this.cachedPid !== pid || this.cachedCsrfToken !== csrf_token) {
            this.cachedPort = null;
            this.cachedPid = pid;
            this.cachedCsrfToken = csrf_token;
        }

        let targetPort = this.cachedPort;

        if (!targetPort) {
            const ports = await this.getListeningPorts(pid);
            for (const port of ports) {
                try {
                    const data = await this.requestApi(port, csrf_token);
                    targetPort = port;
                    this.cachedPort = port;
                    return data.clientModelConfigs || [];
                } catch (e) {
                    continue; // try next port
                }
            }
        } else {
            try {
                const data = await this.requestApi(targetPort, csrf_token);
                return data.clientModelConfigs || [];
            } catch (e) {
                // cache might be invalid
                this.cachedPort = null;
                return this.fetchQuota();
            }
        }
        return [];
    }
}
