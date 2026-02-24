import { spawn, ChildProcess } from 'child_process';

export interface TaskOptions {
    id: string;
    command: string;
    args: string[];
    cwd: string;
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
    onClose?: (code: number) => void;
}

export class ProcessManager {
    private maxConcurrentTasks: number;
    private queue: TaskOptions[] = [];
    private runningProcesses: Map<string, ChildProcess> = new Map();

    constructor(maxConcurrentTasks: number = 1) {
        this.maxConcurrentTasks = maxConcurrentTasks;
    }

    public async submitTask(options: TaskOptions): Promise<void> {
        this.queue.push(options);
        this.runNext();
    }

    private runNext() {
        if (this.runningProcesses.size >= this.maxConcurrentTasks) {
            return;
        }

        const nextTask = this.queue.shift();
        if (!nextTask) {
            return;
        }

        const { id, command, args, cwd, onStdout, onStderr, onClose } = nextTask;

        const child = spawn(command, args, { cwd });
        this.runningProcesses.set(id, child);

        child.stdout?.on('data', (data: Buffer | string) => {
            if (onStdout) {
                onStdout(data.toString());
            }
        });

        child.stderr?.on('data', (data: Buffer | string) => {
            if (onStderr) {
                onStderr(data.toString());
            }
        });

        child.on('close', (code: number | null) => {
            this.runningProcesses.delete(id);
            if (onClose) {
                onClose(code ?? 0);
            }
            this.runNext();
        });
    }

    public stopTask(taskId: string): boolean {
        const child = this.runningProcesses.get(taskId);
        if (child) {
            child.kill();
            this.runningProcesses.delete(taskId);
            return true;
        }
        // Check if queued
        const indexInQueue = this.queue.findIndex((task) => task.id === taskId);
        if (indexInQueue !== -1) {
            this.queue.splice(indexInQueue, 1);
            return true;
        }
        return false;
    }
}
