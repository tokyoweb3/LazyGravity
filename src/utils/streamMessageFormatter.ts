/**
 * Generate mode/model lines for initial status display.
 * Consolidates into a single line if Fast and Plan models are the same.
 */
export function buildModeModelLines(modeName: string, fastModel: string, planModel: string): string[] {
    const lines = [`Current Mode: ${modeName}`];
    if (fastModel.trim().toLowerCase() === planModel.trim().toLowerCase()) {
        lines.push(`Model: ${fastModel}`);
        return lines;
    }

    lines.push(`Fast Model: ${fastModel}`);
    lines.push(`Plan Model: ${planModel}`);
    return lines;
}

/**
 * Filter out activity logs that tend to be noise in Discord display.
 */
export function shouldSkipActivityLog(activity: string, modeName: string, modelName: string): boolean {
    const normalized = activity.trim().toLowerCase();
    if (!normalized) return true;

    const modeLower = modeName.trim().toLowerCase();
    const modelLower = modelName.trim().toLowerCase();
    if (normalized === modeLower || normalized === modelLower) return true;

    if (/^(?:fast|planning|plan|generating\.*|thinking\.*|processing\.*|working\.*)$/.test(normalized)) {
        return true;
    }

    // Single-word logs that tend to be noise (create / ready / pull. etc.)
    if (/^[a-z][a-z0-9_-]{1,24}[.!…]?$/.test(normalized)) {
        return true;
    }

    // Detailed trace for file reading operations (Analyzed....)
    if (/^analyzed/.test(normalized)) {
        return true;
    }

    return false;
}

/**
 * Split text into multiple chunks for Embed description.
 */
export function splitForEmbedDescription(text: string, maxLength: number = 3500): string[] {
    if (text.length <= maxLength) return [text];

    const lines = text.split('\n');
    const chunks: string[] = [];
    let current = '';

    const flush = () => {
        if (!current) return;
        chunks.push(current);
        current = '';
    };

    for (const line of lines) {
        const candidate = current ? `${current}\n${line}` : line;
        if (candidate.length <= maxLength) {
            current = candidate;
            continue;
        }

        flush();
        if (line.length <= maxLength) {
            current = line;
            continue;
        }

        let cursor = 0;
        while (cursor < line.length) {
            chunks.push(line.slice(cursor, cursor + maxLength));
            cursor += maxLength;
        }
    }

    flush();
    return chunks.length > 0 ? chunks : [''];
}

/**
 * Fit text within the limit for a single Embed description.
 * When exceeding the limit, truncate the beginning and prioritize displaying the tail (most recent part).
 */
export function fitForSingleEmbedDescription(text: string, maxLength: number = 3500): string {
    if (text.length <= maxLength) return text;
    const prefix = '... (beginning truncated)\n';
    const tailLength = Math.max(0, maxLength - prefix.length);
    return `${prefix}${text.slice(-tailLength)}`;
}
