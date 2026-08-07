import { createFileChangeButtonAction } from '../fileChangeButtonAction';

describe('fileChangeButtonAction', () => {
    let mockInteraction: any;
    let mockCdp: any;
    let mockBridge: any;
    let mockWsHandler: any;

    beforeEach(() => {
        mockInteraction = {
            deferUpdate: jest.fn().mockResolvedValue(undefined),
            reply: jest.fn().mockResolvedValue(undefined),
            update: jest.fn().mockResolvedValue(undefined),
            followUp: jest.fn().mockResolvedValue(undefined),
        };

        mockCdp = {
            isConnected: jest.fn().mockReturnValue(true),
            call: jest.fn(),
        };

        mockBridge = {
            lastActiveWorkspace: 'test_project',
            pool: {
                getConnected: jest.fn().mockReturnValue(mockCdp),
                extractProjectName: jest.fn().mockReturnValue('test_project'),
            },
        };

        mockWsHandler = {
            getWorkspaceForChannel: jest.fn().mockReturnValue('test_project'),
        };
    });

    it('matches valid legacy custom IDs', () => {
        const action = createFileChangeButtonAction({ bridge: mockBridge, wsHandler: mockWsHandler });
        expect(action.match('ide_file_accept_all')).toEqual({ action: 'accept', projectName: '', channelId: '' });
        expect(action.match('ide_file_reject_all')).toEqual({ action: 'reject', projectName: '', channelId: '' });
        expect(action.match('unknown_button')).toBeNull();
    });

    it('matches valid custom IDs with project and channel', () => {
        const action = createFileChangeButtonAction({ bridge: mockBridge, wsHandler: mockWsHandler });
        expect(action.match('file_change_accept:proj:chan1')).toEqual({ action: 'accept', projectName: 'proj', channelId: 'chan1' });
        expect(action.match('file_change_reject:proj:chan2')).toEqual({ action: 'reject', projectName: 'proj', channelId: 'chan2' });
    });

    it('fails if linked to a different session channel', async () => {
        mockInteraction.channel = { id: 'channel_123' };
        const action = createFileChangeButtonAction({ bridge: mockBridge, wsHandler: mockWsHandler });
        
        await action.execute(mockInteraction, { action: 'accept', channelId: 'channel_456' });
        
        expect(mockInteraction.reply).toHaveBeenCalledWith({ text: 'This file change action is linked to a different session channel.' });
    });

    it('fails if not connected to IDE', async () => {
        mockInteraction.channel = { id: 'channel_123' };
        mockCdp.isConnected.mockReturnValue(false);
        const action = createFileChangeButtonAction({ bridge: mockBridge, wsHandler: mockWsHandler });
        
        await action.execute(mockInteraction, { action: 'accept', channelId: 'channel_123' });
        
        expect(mockInteraction.reply).toHaveBeenCalledWith({ text: 'Not connected to IDE.' });
    });

    it('successfully accepts changes when button is found', async () => {
        mockInteraction.channel = { id: 'channel_123' };
        mockCdp.call.mockResolvedValue({ result: { value: true } });
        const action = createFileChangeButtonAction({ bridge: mockBridge, wsHandler: mockWsHandler });
        
        await action.execute(mockInteraction, { action: 'accept' });
        
        expect(mockCdp.call).toHaveBeenCalled();
        expect(mockInteraction.update).toHaveBeenCalledWith({
            text: '✅ Accepted file changes.',
            components: [],
        });
    });

    it('successfully rejects changes when button is found', async () => {
        mockInteraction.channel = { id: 'channel_123' };
        mockCdp.call.mockResolvedValue({ result: { value: true } });
        const action = createFileChangeButtonAction({ bridge: mockBridge, wsHandler: mockWsHandler });
        
        await action.execute(mockInteraction, { action: 'reject' });
        
        expect(mockInteraction.update).toHaveBeenCalledWith({
            text: '❌ Rejected file changes.',
            components: [],
        });
    });

    it('sends followup if button is not found', async () => {
        mockInteraction.channel = { id: 'channel_123' };
        mockCdp.call.mockResolvedValue({ result: { value: false } });
        const action = createFileChangeButtonAction({ bridge: mockBridge, wsHandler: mockWsHandler });
        
        await action.execute(mockInteraction, { action: 'accept' });
        
        expect(mockInteraction.followUp).toHaveBeenCalledWith({
            text: expect.stringContaining('Could not find the "Accept all" button'),
        });
    });
});
