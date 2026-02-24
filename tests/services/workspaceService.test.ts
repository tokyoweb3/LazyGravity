import fs from 'fs';
import path from 'path';
import os from 'os';
import { WorkspaceService } from '../../src/services/workspaceService';

describe('WorkspaceService', () => {
    let tmpDir: string;
    let service: WorkspaceService;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-test-'));
        service = new WorkspaceService(tmpDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('ensureBaseDir', () => {
        it('creates the base directory when it does not exist', () => {
            const newDir = path.join(tmpDir, 'nested', 'dir');
            const svc = new WorkspaceService(newDir);
            svc.ensureBaseDir();
            expect(fs.existsSync(newDir)).toBe(true);
        });

        it('does not throw an error when the directory already exists', () => {
            expect(() => service.ensureBaseDir()).not.toThrow();
        });
    });

    describe('scanWorkspaces', () => {
        it('returns subdirectory list in sorted order', () => {
            fs.mkdirSync(path.join(tmpDir, 'project-b'));
            fs.mkdirSync(path.join(tmpDir, 'project-a'));
            fs.mkdirSync(path.join(tmpDir, 'project-c'));

            const result = service.scanWorkspaces();
            expect(result).toEqual(['project-a', 'project-b', 'project-c']);
        });

        it('does not include files', () => {
            fs.mkdirSync(path.join(tmpDir, 'project-a'));
            fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'hello');

            const result = service.scanWorkspaces();
            expect(result).toEqual(['project-a']);
        });

        it('does not include dotfiles or dot directories', () => {
            fs.mkdirSync(path.join(tmpDir, '.hidden'));
            fs.mkdirSync(path.join(tmpDir, 'visible'));

            const result = service.scanWorkspaces();
            expect(result).toEqual(['visible']);
        });

        it('returns an empty array for an empty directory', () => {
            expect(service.scanWorkspaces()).toEqual([]);
        });
    });

    describe('validatePath', () => {
        it('resolves a valid relative path to an absolute path', () => {
            const result = service.validatePath('my-project');
            expect(result).toBe(path.join(tmpDir, 'my-project'));
        });

        it('rejects path traversal', () => {
            expect(() => service.validatePath('../etc/passwd')).toThrow('Path traversal detected');
        });

        it('rejects nested path traversal', () => {
            expect(() => service.validatePath('a/../../etc')).toThrow('Path traversal detected');
        });
    });

    describe('exists', () => {
        it('returns true for an existing directory', () => {
            fs.mkdirSync(path.join(tmpDir, 'my-project'));
            expect(service.exists('my-project')).toBe(true);
        });

        it('returns false for a non-existent directory', () => {
            expect(service.exists('nonexistent')).toBe(false);
        });

        it('returns false for a file', () => {
            fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'data');
            expect(service.exists('file.txt')).toBe(false);
        });
    });

    describe('getBaseDir', () => {
        it('returns the base directory', () => {
            expect(service.getBaseDir()).toBe(tmpDir);
        });
    });

    describe('getWorkspacePath', () => {
        it('returns the absolute path of the workspace', () => {
            expect(service.getWorkspacePath('proj')).toBe(path.join(tmpDir, 'proj'));
        });

        it('rejects path traversal', () => {
            expect(() => service.getWorkspacePath('../outside')).toThrow('Path traversal detected');
        });
    });
});
