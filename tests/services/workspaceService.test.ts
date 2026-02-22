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
        it('ベースディレクトリが存在しない場合に作成すること', () => {
            const newDir = path.join(tmpDir, 'nested', 'dir');
            const svc = new WorkspaceService(newDir);
            svc.ensureBaseDir();
            expect(fs.existsSync(newDir)).toBe(true);
        });

        it('既に存在する場合はエラーにならないこと', () => {
            expect(() => service.ensureBaseDir()).not.toThrow();
        });
    });

    describe('scanWorkspaces', () => {
        it('サブディレクトリ一覧をソート順で返すこと', () => {
            fs.mkdirSync(path.join(tmpDir, 'project-b'));
            fs.mkdirSync(path.join(tmpDir, 'project-a'));
            fs.mkdirSync(path.join(tmpDir, 'project-c'));

            const result = service.scanWorkspaces();
            expect(result).toEqual(['project-a', 'project-b', 'project-c']);
        });

        it('ファイルは含まないこと', () => {
            fs.mkdirSync(path.join(tmpDir, 'project-a'));
            fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'hello');

            const result = service.scanWorkspaces();
            expect(result).toEqual(['project-a']);
        });

        it('ドットファイル/ディレクトリは含まないこと', () => {
            fs.mkdirSync(path.join(tmpDir, '.hidden'));
            fs.mkdirSync(path.join(tmpDir, 'visible'));

            const result = service.scanWorkspaces();
            expect(result).toEqual(['visible']);
        });

        it('空ディレクトリの場合は空配列を返すこと', () => {
            expect(service.scanWorkspaces()).toEqual([]);
        });
    });

    describe('validatePath', () => {
        it('正常な相対パスを絶対パスに解決すること', () => {
            const result = service.validatePath('my-project');
            expect(result).toBe(path.join(tmpDir, 'my-project'));
        });

        it('パストラバーサルを拒否すること', () => {
            expect(() => service.validatePath('../etc/passwd')).toThrow('Path traversal detected');
        });

        it('ネストしたパストラバーサルを拒否すること', () => {
            expect(() => service.validatePath('a/../../etc')).toThrow('Path traversal detected');
        });
    });

    describe('exists', () => {
        it('存在するディレクトリの場合はtrueを返すこと', () => {
            fs.mkdirSync(path.join(tmpDir, 'my-project'));
            expect(service.exists('my-project')).toBe(true);
        });

        it('存在しないディレクトリの場合はfalseを返すこと', () => {
            expect(service.exists('nonexistent')).toBe(false);
        });

        it('ファイルの場合はfalseを返すこと', () => {
            fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'data');
            expect(service.exists('file.txt')).toBe(false);
        });
    });

    describe('getBaseDir', () => {
        it('ベースディレクトリを返すこと', () => {
            expect(service.getBaseDir()).toBe(tmpDir);
        });
    });

    describe('getWorkspacePath', () => {
        it('ワークスペースの絶対パスを返すこと', () => {
            expect(service.getWorkspacePath('proj')).toBe(path.join(tmpDir, 'proj'));
        });
    });
});
