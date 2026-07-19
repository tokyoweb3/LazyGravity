/**
 * Service to manage executing, queueing, and terminating child processes.
 */

import { spawn, ChildProcess } from 'child_process';

/**
 * Configuration options defining a process task definition.
 */
export interface TaskOptions {
    /** Unique task ID. */
    id: string;
    /** Shell command to invoke. */
    command: string;
    /** Arguments array passed to command. */
    args: string[];
    /** Cwd working directory. */
    cwd: string;
    /** Optional standard output listener callback. */
    onStdout?: (data: string) => void;
    /** Optional standard error listener callback. */
    onStderr?: (data: string) => void;
    /** Optional callback triggered on process exit. */
    onClose?: (code: number) => void;
}

/**
 * Manager that executes background child process tasks with concurrency limits.
 */
export class ProcessManager {
    /** Maximum allowed concurrent tasks. */
    private maxConcurrentTasks: number;
    /** Pending tasks queue. */
    private queue: TaskOptions[] = [];
    /** Active processes registry index map. */
    private runningProcesses: Map<string, ChildProcess> = new Map();

    /**
     * Initializes the ProcessManager instance.
     * @param maxConcurrentTasks Concurrent run limits (default: 1).
     */
    constructor(maxConcurrentTasks: number = 1) {
        this.maxConcurrentTasks = maxConcurrentTasks;
    }

    /**
     * Submits a new process task to the task queue.
     * @param options Task specifications.
     */
    public async submitTask(options: TaskOptions): Promise<void> {
        this.queue.push(options);
        this.runNext();
    }

    /**
     * Dequeues and spawns the next pending task if concurrency limits permit.
     */
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

    /**
     * Force kills or removes a registered task.
     * @param taskId The target task identifier.
     * @returns True if successfully cancelled/terminated, false otherwise.
     */
    public stopTask(taskId: string): boolean {
        const child = this.runningProcesses.get(taskId);
        if (child) {
            child.kill();
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
