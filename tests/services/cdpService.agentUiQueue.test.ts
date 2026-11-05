import { CdpService } from '../../src/services/cdpService';

function gate() {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
}

describe('shared agent UI queue', () => {
    let cdp: CdpService;
    const result = { ok: true, method: 'enter', contextId: -3 };

    beforeEach(() => {
        cdp = new CdpService();
        (cdp as any).isConnectedFlag = true;
        (cdp as any).ws = {};
    });

    afterEach(() => { jest.restoreAllMocks(); });

    /** Exercise both public injection entry points against the same focus-ownership queue. */
    function inject(images: boolean) {
        return images ? cdp.injectMessageWithImageFiles('prompt', ['/tmp/image.png']) : cdp.injectMessage('prompt');
    }

    it.each([false, true])('keeps model reads and changes outside the whole injection (images=%s)', async images => {
        const blocked = gate();
        const started = gate();
        const events: string[] = [];
        jest.spyOn(cdp as any, 'injectMessageCore').mockImplementation(async () => {
            events.push('focus');
            started.release();
            await blocked.promise;
            events.push('send');
            return result;
        });
        jest.spyOn(cdp as any, 'readUiModels').mockImplementation(async () => { events.push('list models'); return ['Model A']; });
        jest.spyOn(cdp as any, 'applyUiModel').mockImplementation(async () => { events.push('change model'); return { ok: true }; });
        const injection = inject(images);
        const models = cdp.getUiModels();
        const selection = cdp.setUiModel('Model A');
        await started.promise;
        expect(events).toEqual(['focus']);
        blocked.release();
        expect(await injection).toEqual(result);
        await Promise.all([models, selection]);
        expect(events).toEqual(['focus', 'send', 'list models', 'change model']);
    });

    it.each([false, true])('waits for an open model operation before focusing input (images=%s)', async images => {
        const blocked = gate();
        const started = gate();
        jest.spyOn(cdp as any, 'readUiModels').mockImplementation(async () => {
            started.release();
            await blocked.promise;
            return ['Model A'];
        });
        const core = jest.spyOn(cdp as any, 'injectMessageCore').mockResolvedValue(result);
        const models = cdp.getUiModels();
        const injection = inject(images);
        await started.promise;
        expect(core).not.toHaveBeenCalled();
        blocked.release();
        await models;
        expect(await injection).toEqual(result);
        expect(core).toHaveBeenCalledWith('prompt', ...(images ? [['/tmp/image.png']] : []));
    });

    it.each([false, true])('keeps transient retries in the same queue (images=%s)', async images => {
        const blocked = gate();
        const started = gate();
        jest.spyOn(cdp as any, 'injectMessageCore').mockResolvedValue({ ok: false, error: 'Chat input field not found' });
        const retry = jest.spyOn(cdp as any, 'retryInjectOnce').mockImplementation(async () => {
            started.release();
            await blocked.promise;
            return result;
        });
        const read = jest.spyOn(cdp as any, 'readCurrentModel').mockResolvedValue('Model A');
        const injection = inject(images);
        const model = cdp.getCurrentModel();
        await started.promise;
        expect(read).not.toHaveBeenCalled();
        blocked.release();
        expect(await injection).toEqual(result);
        expect(await model).toBe('Model A');
        expect(retry).toHaveBeenCalledWith('prompt', 'Chat input field not found', ...(images ? [['/tmp/image.png']] : []));
    });

    it('releases the queue after an injection error', async () => {
        jest.spyOn(cdp as any, 'injectMessageCore').mockRejectedValue(new Error('Input disconnected'));
        jest.spyOn(cdp as any, 'readUiModels').mockResolvedValue(['Model A']);
        const injection = cdp.injectMessage('prompt');
        const models = cdp.getUiModels();
        await expect(injection).rejects.toThrow('Input disconnected');
        expect(await models).toEqual(['Model A']);
    });
});
