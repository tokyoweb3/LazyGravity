import { resolveProjectName } from '../../src/utils/projectResolver';

describe('project resolver', () => {
    const workspace = '/projects/complete-project';
    function setup(bound: string | null) {
        return { wsHandler: { getWorkspaceForChannel: jest.fn().mockReturnValue(bound) },
            bridge: { pool: { extractProjectName: jest.fn().mockReturnValue('complete-project') } } } as any;
    }

    it('preserves explicit-project precedence for existing callers', () => {
        const deps = setup(workspace);
        expect(resolveProjectName(deps, 'channel', 'explicit-project')).toBe('explicit-project');
        expect(deps.wsHandler.getWorkspaceForChannel).not.toHaveBeenCalled();
    });

    it('prefers the full channel binding for question controls', () => {
        const deps = setup(workspace);
        expect(resolveProjectName(deps, 'channel', 'truncated', { preferChannelBinding: true })).toBe('complete-project');
        expect(deps.bridge.pool.extractProjectName).toHaveBeenCalledWith(workspace);
    });

    it('falls back to the provided project when a channel has no binding', () => {
        expect(resolveProjectName(setup(null), 'channel', 'project', { preferChannelBinding: true })).toBe('project');
        expect(resolveProjectName(setup(null), 'channel')).toBeUndefined();
    });
});
