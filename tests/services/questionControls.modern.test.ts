import { buildQuestionNotification, QUESTION_SELECT_ACTION_PREFIX, QUESTION_SKIP_ACTION_PREFIX } from '../../src/services/notificationSender';
import { parseQuestionCustomId } from '../../src/utils/questionActionUtils';
import { createQuestionSelectAction } from '../../src/handlers/questionSelectAction';
import { createQuestionSkipAction } from '../../src/handlers/questionSkipAction';
import { toDiscordPayload } from '../../src/platform/discord/wrappers';
import { richContentToHtml } from '../../src/platform/telegram/telegramFormatter';
import { EmbedBuilder } from 'discord.js';

jest.mock('../../src/utils/projectResolver', () => ({ resolveProjectName: () => 'TestProject' }));

describe('Question notification identity', () => {
    const questionId = '0123456789abcdef';

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

    it('round-trips question and channel identities within Discord custom ID limits', () => {
        const payload = buildQuestionNotification({ title: 'Allow read access?', description: '/projects/other/AGENTS.md',
            projectName: '專案'.repeat(80), channelId: '123456789012345678', questionId,
            options: [{ text: 'Yes, allow this time', x: 0, y: 0 }, { text: 'No', x: 0, y: 0 }] });
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
    });

    it('passes the original question identity through both interaction handlers', async () => {
        const detector = { submitOption: jest.fn().mockResolvedValue(true), skipQuestion: jest.fn().mockResolvedValue(true) };
        const deps = { bridge: { pool: { getQuestionDetector: () => detector } }, wsHandler: {} } as any;
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
