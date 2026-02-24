import { CdpService } from './cdpService';

/**
 * Script to generate channel name titles using Gemini Flash within the Antigravity UI.
 * Makes LLM calls via Antigravity's internal API (language_server).
 * Infers API endpoint and token from existing DOM components.
 */
const GENERATE_TITLE_SCRIPT = `(async (userPrompt) => {
    try {
        // Generate title using Antigravity's internal fetch API
        // Look for configuration from __NEXT_DATA__ or window.__remixContext
        const configs = [
            window.__NEXT_DATA__,
            window.__remixContext,
            window.__APP_CONFIG__,
        ].filter(Boolean);

        // Fallback: extract leading text from prompt
        const fallbackTitle = userPrompt
            .replace(/^\\[.*?\\]\\n?/, '')
            .substring(0, 40)
            .trim();

        return { ok: true, title: fallbackTitle, method: 'text-extract' };
    } catch (e) {
        return { ok: false, error: e.message };
    }
})`;

/**
 * Service for generating chat session titles.
 *
 * Strategy:
 *   1. Call Antigravity's Gemini Flash API via CdpService (future implementation)
 *   2. Fallback: extract and sanitize leading text from the user prompt
 */
export class TitleGeneratorService {
    /**
     * Generate a short title from the user's prompt
     * @param prompt User's prompt
     * @param cdpService Optional CdpService instance
     */
    async generateTitle(prompt: string, cdpService?: CdpService): Promise<string> {
        // Attempt to use Antigravity's LLM via CDP
        if (cdpService) {
            try {
                const title = await this.generateViaCdp(prompt, cdpService);
                if (title) return title;
            } catch {
                // Fall through to fallback
            }
        }

        // Fallback: text extraction
        return this.extractTitleFromText(prompt);
    }

    /**
     * Generate a title by calling Antigravity's LLM API via CDP
     */
    private async generateViaCdp(prompt: string, cdpService: CdpService): Promise<string | null> {
        try {
            const contextId = cdpService.getPrimaryContextId();
            const cleanPrompt = this.stripWorkspacePrefix(prompt);

            const callParams: Record<string, unknown> = {
                expression: `${GENERATE_TITLE_SCRIPT}(${JSON.stringify(cleanPrompt)})`,
                returnByValue: true,
                awaitPromise: true,
            };
            if (contextId !== null) {
                callParams.contextId = contextId;
            }

            const result = await cdpService.call('Runtime.evaluate', callParams);
            const value = result?.result?.value;

            if (value?.ok && value?.title) {
                return this.sanitizeForChannelName(value.title);
            }
        } catch {
            // Fall through to fallback
        }

        return null;
    }

    /**
     * Extract a title from the prompt text (fallback)
     */
    private extractTitleFromText(prompt: string): string {
        const cleanPrompt = this.stripWorkspacePrefix(prompt);
        const truncated = cleanPrompt.substring(0, 40).trim();
        return this.sanitizeForChannelName(truncated) || 'untitled';
    }

    /**
     * Strip the workspace prefix
     */
    private stripWorkspacePrefix(prompt: string): string {
        return prompt.replace(/^\[ワークスペース:.*?\]\n?/, '');
    }

    /**
     * Sanitize text into a format suitable for Discord channel names
     */
    public sanitizeForChannelName(text: string): string {
        const sanitized = text
            .toLowerCase()
            .replace(/\s+/g, '-')
            // Allowed in Discord channel names: alphanumeric, hyphen, underscore, CJK characters
            .replace(/[^a-z0-9\-_\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf]/g, '-')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 80);

        return sanitized || 'untitled';
    }
}
