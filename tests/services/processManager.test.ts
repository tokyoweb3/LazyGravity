import { ProcessManager, TaskOptions } from '../../src/services/processManager';
import { spawn } from 'child_process';

// Mock child_process spawn
jest.mock('child_process', () => {
    return {
        spawn: jest.fn()
    };
});

describe('ProcessManager', () => {
    let processManager: ProcessManager;
    let mockSpawn: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        processManager = new ProcessManager(1); // Initialize with max concurrency of 1
        mockSpawn = spawn as jest.Mock;
    });

    it('should spawn a process with correct arguments', async () => {
        const mockOn = jest.fn();
        const mockStdoutOn = jest.fn();
        const mockStderrOn = jest.fn();

        // Mock process object returned by spawn
        mockSpawn.mockReturnValue({
            pid: 12345,
            stdout: { on: mockStdoutOn },
            stderr: { on: mockStderrOn },
            on: mockOn,
            kill: jest.fn(),
        });

        const options: TaskOptions = {
            id: 'task-1',
            command: 'antigravity',
            args: ['--prompt', 'test'],
            cwd: '/fake/dir',
        };

        // submitTask is expected to complete the process launch asynchronously
        processManager.submitTask(options);

        // Expected to be called synchronously (executed immediately since queue is empty)
        // If asynchronous, wait with setImmediate etc.
        await new Promise(process.nextTick);

        expect(mockSpawn).toHaveBeenCalledWith('antigravity', ['--prompt', 'test'], { cwd: '/fake/dir' });
        expect(mockStdoutOn).toHaveBeenCalledWith('data', expect.any(Function));
        expect(mockStderrOn).toHaveBeenCalledWith('data', expect.any(Function));
        expect(mockOn).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should pass stdout and stderr to callbacks', async () => {
        let stdoutCallback: any;
        let stderrCallback: any;

        const mockStdoutOn = jest.fn((event, cb) => {
            if (event === 'data') stdoutCallback = cb;
        });
        const mockStderrOn = jest.fn((event, cb) => {
            if (event === 'data') stderrCallback = cb;
        });

        mockSpawn.mockReturnValue({
            pid: 12345,
            stdout: { on: mockStdoutOn },
            stderr: { on: mockStderrOn },
            on: jest.fn(),
            kill: jest.fn(),
        });

        const onStdout = jest.fn();
        const onStderr = jest.fn();

        processManager.submitTask({
            id: 'task-2',
            command: 'echo',
            args: ['hello'],
            cwd: '/fake/dir',
            onStdout,
            onStderr,
        });

        await new Promise(process.nextTick);

        // Invoke callbacks and verify
        if (stdoutCallback) { stdoutCallback(Buffer.from('hello output')); }
        if (stderrCallback) { stderrCallback(Buffer.from('error output')); }

        expect(onStdout).toHaveBeenCalledWith('hello output');
        expect(onStderr).toHaveBeenCalledWith('error output');
    });

    it('should limit concurrent executions and queue tasks', async () => {
        // Simulate a state where the process does not terminate
        let closeFirstTask: any;
        mockSpawn.mockImplementation(() => {
            return {
                pid: 100,
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() },
                on: jest.fn((event, cb) => {
                    if (event === 'close') {
                        closeFirstTask = cb;
                    }
                }),
                kill: jest.fn(),
            };
        });

        processManager.submitTask({ id: 'task-1', command: 'cmd1', args: [], cwd: '/' });
        processManager.submitTask({ id: 'task-2', command: 'cmd2', args: [], cwd: '/' });

        await new Promise(process.nextTick);

        // Since max concurrency is 1, spawn should only be called once
        expect(mockSpawn).toHaveBeenCalledTimes(1);
        expect(mockSpawn).toHaveBeenCalledWith('cmd1', [], { cwd: '/' });

        // Terminate the first task
        closeFirstTask(0);

        // Wait for the second task to be executed from the queue
        await new Promise(process.nextTick);

        expect(mockSpawn).toHaveBeenCalledTimes(2);
        expect(mockSpawn).toHaveBeenLastCalledWith('cmd2', [], { cwd: '/' });
    });

    it('should kill a running process on stopTask', async () => {
        const mockKill = jest.fn();
        mockSpawn.mockReturnValue({
            pid: 123,
            stdout: { on: jest.fn() },
            stderr: { on: jest.fn() },
            on: jest.fn(),
            kill: mockKill,
        });

        processManager.submitTask({ id: 'task-to-kill', command: 'sleep', args: ['10'], cwd: '/' });

        await new Promise(process.nextTick);

        const result = processManager.stopTask('task-to-kill');

        expect(result).toBe(true);
        expect(mockKill).toHaveBeenCalled();
    });
});
