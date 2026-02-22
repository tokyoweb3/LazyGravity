export interface TaskMetadata {
    taskId?: string;
    directory?: string;
}

export function extractMetadataFromFooter(footerText: string): TaskMetadata {
    const result: TaskMetadata = {};

    const taskIdMatch = footerText.match(/TaskID:\s*([^\s|]+)/i);
    if (taskIdMatch && taskIdMatch[1]) {
        result.taskId = taskIdMatch[1];
    }

    const dirMatch = footerText.match(/Dir:\s*([^\s|]+)/i);
    if (dirMatch && dirMatch[1]) {
        result.directory = dirMatch[1];
    }

    return result;
}
