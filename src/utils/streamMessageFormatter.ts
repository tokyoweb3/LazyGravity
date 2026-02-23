/**
 * 初期ステータス表示用のモード/モデル行を生成する。
 * Fast/Planモデルが同一の場合は1行に集約する。
 */
export function buildModeModelLines(modeName: string, fastModel: string, planModel: string): string[] {
    const lines = [`現在モード: ${modeName}`];
    if (fastModel.trim().toLowerCase() === planModel.trim().toLowerCase()) {
        lines.push(`モデル: ${fastModel}`);
        return lines;
    }

    lines.push(`Fastモデル: ${fastModel}`);
    lines.push(`Planモデル: ${planModel}`);
    return lines;
}

/**
 * Discord表示でノイズになりやすいアクティビティログを除外する。
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

    // ノイズになりやすい1語ログ（create / ready / pull. など）
    if (/^[a-z][a-z0-9_-]{1,24}[.!…]?$/.test(normalized)) {
        return true;
    }

    // ファイル読み取り系の詳細トレース（Analyzed....）
    if (/^analyzed/.test(normalized)) {
        return true;
    }

    return false;
}

/**
 * Embed description向けにテキストを複数チャンクへ分割する。
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
 * 単一Embed description用にテキストを上限内へ収める。
 * 上限超過時は先頭を省略して末尾側（最新部分）を優先表示する。
 */
export function fitForSingleEmbedDescription(text: string, maxLength: number = 3500): string {
    if (text.length <= maxLength) return text;
    const prefix = '… (先頭を省略)\n';
    const tailLength = Math.max(0, maxLength - prefix.length);
    return `${prefix}${text.slice(-tailLength)}`;
}
