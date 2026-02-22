import { resolveSafePath } from '../../src/middleware/sanitize';
import path from 'path';

describe('Sanitize Middleware', () => {
    const baseDir = '/home/user/workspace';

    it('resolves a valid path within the base directory', () => {
        const inputPath = 'project/src/index.ts';
        const expectedPath = path.resolve(baseDir, inputPath);

        const result = resolveSafePath(inputPath, baseDir);
        expect(result).toEqual(expectedPath);
    });

    it('throws an error if the path attempts to traverse outside the base directory', () => {
        const inputPath = '../config/secret.json';

        expect(() => resolveSafePath(inputPath, baseDir)).toThrow('Path traversal detected');
    });

    it('throws an error if the path uses absolute path outside the base directory', () => {
        const inputPath = '/etc/passwd';

        expect(() => resolveSafePath(inputPath, baseDir)).toThrow('Path traversal detected');
    });

    it('resolves an absolute path if it is within the base directory', () => {
        const inputPath = '/home/user/workspace/project/README.md';
        const expectedPath = path.resolve(baseDir, 'project/README.md');

        const result = resolveSafePath(inputPath, baseDir);
        expect(result).toEqual(expectedPath);
    });
});
