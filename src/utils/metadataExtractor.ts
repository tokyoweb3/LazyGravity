/**
 * Metadata parameters parsed from message footers.
 */
export interface TaskMetadata {
    /** Target background execution task identifier. */
    taskId?: string;
    /** Current working directory path of the task. */
    directory?: string;
}

/**
 * Extracts task identifiers and working directory paths from a formatted footer string.
 * @param footerText Raw footer text.
 * @returns Parsed metadata properties object.
 */
export function extractMetadataFromFooter(footerText: string): TaskMetadata {
    const result: TaskMetadata = {};

    const taskIdMatch = footerText.match(/TaskID:\s*([^\s|]+)/i);
    if (taskIdMatch && taskIdMatch[1]) {
        result.taskId = taskIdMatch[1];
    }

    const dirMatch = footerText.match(/Dir:\s*([^|]+)/i);
    if (dirMatch && dirMatch[1]) {
        const trimmed = dirMatch[1].trim();
        if (trimmed.length > 0) {
            result.directory = trimmed;
        }
    }

    return result;
}
