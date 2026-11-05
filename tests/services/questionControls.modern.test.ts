import { buildQuestionNotification, buildResolvedOverlay, QUESTION_SELECT_ACTION_PREFIX, QUESTION_SKIP_ACTION_PREFIX } from '../../src/services/notificationSender';
import { parseQuestionCustomId } from '../../src/utils/questionActionUtils';
import { createQuestionSelectAction } from '../../src/handlers/questionSelectAction';
import { createQuestionSkipAction } from '../../src/handlers/questionSkipAction';
import { toDiscordPayload } from '../../src/platform/discord/wrappers';
import { richContentToHtml } from '../../src/platform/telegram/telegramFormatter';
import { EmbedBuilder } from 'discord.js';

function actionDeps(detector: any, project = 'TestProject') {
    return { bridge: { pool: {
        extractProjectName: () => project,
        getQuestionDetector: jest.fn((name: string) => name === project ? detector : undefined),
    } }, wsHandler: { getWorkspaceForChannel: () => `/projects/${project}` } } as any;
}

describe('Question notification identity', () => {
    const questionId = '0123456789abcdef';

    it('keeps every answer and the skip action in dropdowns and disables resolved controls', () => {
        const texts = ['Yes, allow this time', 'Yes, and always allow in this conversation', 'Yes, and always allow', 'No'];
        const payload = buildQuestionNotification({ title: 'Allow read access?', description: '/projects/other/AGENTS.md',
            projectName: 'TestProject', channelId: 'channel', questionId,
            options: texts.map(text => ({ text, x: 0, y: 0 })) });
        expect(payload.components).toHaveLength(2);
        expect(payload.components!.flatMap(row => row.components).every(component => component.type === 'selectMenu')).toBe(true);
        expect((payload.components![0].components[0] as any).options.map((option: any) => option.label)).toEqual(texts);
        expect(payload.components![1].components[0]).toMatchObject({ options: [{ label: 'Skip question', value: 'skip' }] });
        const resolved = toDiscordPayload(buildResolvedOverlay(payload, 'Question answered'));
        expect((resolved.components as any[]).every(row => row.toJSON().components[0].disabled)).toBe(true);
    });

    it('handles the skip dropdown through the same question identity checks', async () => {
        const detector = { skipQuestion: jest.fn().mockResolvedValue(true), refresh: jest.fn().mockResolvedValue(undefined) };
        const action = createQuestionSelectAction(actionDeps(detector));
        const interaction = { channel: { id: 'channel' },
            customId: `${QUESTION_SKIP_ACTION_PREFIX}:TestProject:channel:${questionId}`,
            deferUpdate: jest.fn().mockResolvedValue(undefined), editReply: jest.fn().mockResolvedValue(undefined),
            followUp: jest.fn().mockResolvedValue(undefined),
        } as any;
        expect(action.match(interaction.customId)).toBe(true);
        expect(await action.execute(interaction, ['skip'])).toBe(true);
        expect(detector.skipQuestion).toHaveBeenCalledWith(questionId);
    });

    it('preserves path and PowerShell underscores when rendering a Discord question', () => {
        const description = String.raw`Get-ChildItem C:\work\Sample_Studio | Where-Object { $_.Name -ne '__pycache__' }; echo "a*b"`;
        const payload = buildQuestionNotification({ title: 'Allow listing files?', description,
            projectName: 'TestProject', channelId: 'channel', questionId, options: [] });
        expect(payload.richContent!.description).toBe(description);
        const rendered = toDiscordPayload(payload);
        expect((rendered.embeds as EmbedBuilder[])[0].toJSON().description).toBe(
            String.raw`Get-ChildItem C:\\work\\Sample\_Studio | Where-Object { $\_.Name -ne '\_\_pycache\_\_' }; echo "a\*b"`,
        );
    });

    it('preserves literal Markdown and escapes HTML in a Telegram question', () => {
        const payload = buildQuestionNotification({ title: 'Allow reading?', description: '**read_me** <config> `path`',
            projectName: 'TestProject', channelId: 'channel', questionId, options: [] });
        expect(richContentToHtml(payload.richContent!)).toContain('**read_me** &lt;config&gt; `path`');
    });

    it('routes truncated Unicode project IDs to the full channel binding for answers and skips', async () => {
        const project = '專案'.repeat(80);
        const payload = buildQuestionNotification({ title: 'Allow read access?', description: '/projects/other/AGENTS.md',
            projectName: project, channelId: '123456789012345678', questionId,
            options: Array.from({ length: 5 }, (_, index) => ({ text: `Choice ${index + 1}`, x: 0, y: 0 })) });
        const selectId = (payload.components![0].components[0] as any).customId;
        const skipId = (payload.components![1].components[0] as any).customId;
        expect(selectId.length).toBeLessThanOrEqual(100);
        expect(skipId.length).toBeLessThanOrEqual(100);
        expect(parseQuestionCustomId(selectId, QUESTION_SELECT_ACTION_PREFIX)).toMatchObject({
            channelId: '123456789012345678', questionId,
        });
        expect(parseQuestionCustomId(skipId, QUESTION_SKIP_ACTION_PREFIX)).toMatchObject({
            channelId: '123456789012345678', questionId,
        });
        const detector = { submitOption: jest.fn().mockResolvedValue(true), skipQuestion: jest.fn().mockResolvedValue(true),
            refresh: jest.fn().mockResolvedValue(undefined) };
        const deps = actionDeps(detector, project);
        const interaction = { channel: { id: '123456789012345678' }, customId: selectId,
            deferUpdate: jest.fn().mockResolvedValue(undefined), editReply: jest.fn().mockResolvedValue(undefined),
            reply: jest.fn().mockResolvedValue(undefined), followUp: jest.fn().mockResolvedValue(undefined),
        } as any;
        expect(await createQuestionSelectAction(deps).execute(interaction, ['1'])).toBe(true);
        interaction.customId = skipId;
        expect(await createQuestionSelectAction(deps).execute(interaction, ['skip'])).toBe(true);
        expect(detector.submitOption).toHaveBeenCalledWith(1, questionId);
        expect(detector.skipQuestion).toHaveBeenCalledWith(questionId);
        expect(deps.bridge.pool.getQuestionDetector).toHaveBeenCalledTimes(2);
        expect(deps.bridge.pool.getQuestionDetector).toHaveBeenCalledWith(project, undefined);
    });

    it('passes the original question identity through both interaction handlers', async () => {
        const detector = { submitOption: jest.fn().mockResolvedValue(true), skipQuestion: jest.fn().mockResolvedValue(true) };
        const deps = actionDeps(detector);
        const interaction = { channel: { id: 'channel' },
            customId: `${QUESTION_SELECT_ACTION_PREFIX}:TestProject:channel:${questionId}`,
            deferUpdate: jest.fn().mockResolvedValue(undefined), editReply: jest.fn().mockResolvedValue(undefined),
            reply: jest.fn().mockResolvedValue(undefined), followUp: jest.fn().mockResolvedValue(undefined),
        } as any;
        expect(await createQuestionSelectAction(deps).execute(interaction, ['1'])).toBe(true);
        expect(detector.submitOption).toHaveBeenCalledWith(1, questionId);
        interaction.customId = `${QUESTION_SKIP_ACTION_PREFIX}:TestProject:channel:${questionId}`;
        expect(await createQuestionSkipAction(deps).execute(interaction, {})).toBe(true);
        expect(detector.skipQuestion).toHaveBeenCalledWith(questionId);
    });
});
