import path from 'path';

export const resolveSafePath = (inputPath: string, baseDir: string): string => {
    const resolvedPath = path.resolve(baseDir, inputPath);
    const normalizedBaseDir = path.resolve(baseDir);

    const relative = path.relative(normalizedBaseDir, resolvedPath);

    if (relative && (relative.startsWith('..' + path.sep) || relative === '..')) {
        throw new Error('Path traversal detected');
    }

    if (path.isAbsolute(relative)) {
        throw new Error('Path traversal detected');
    }

    return resolvedPath;
};
