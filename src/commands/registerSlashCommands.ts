import {
    SlashCommandBuilder,
    REST,
    Routes,
} from 'discord.js';
import { AVAILABLE_MODELS } from '../services/modelService';
import { AVAILABLE_MODES } from '../services/modeService';

/**
 * Discord Interactions API 用のスラッシュコマンド定義
 * Botのスラッシュコマンドをアプリケーションに登録する
 */

/** /mode コマンド定義 */
const modeCommand = new SlashCommandBuilder()
    .setName('mode')
    .setDescription('実行モードを表示・変更します')
    .addStringOption((option) =>
        option
            .setName('name')
            .setDescription('変更先のモード名')
            .setRequired(false)
    );

/** /models コマンド定義 */
const modelsCommand = new SlashCommandBuilder()
    .setName('models')
    .setDescription('利用可能なLLMモデルを表示・変更します')
    .addStringOption((option) =>
        option
            .setName('name')
            .setDescription('変更先のモデル名')
            .setRequired(false)
    );

/** /templates コマンド定義 */
const templatesCommand = new SlashCommandBuilder()
    .setName('templates')
    .setDescription('テンプレートの一覧表示・呼び出し・登録・削除を行います')
    .addSubcommand((sub) =>
        sub
            .setName('list')
            .setDescription('登録済みテンプレート一覧を表示します')
    )
    .addSubcommand((sub) =>
        sub
            .setName('use')
            .setDescription('テンプレートを呼び出して実行します')
            .addStringOption((option) =>
                option
                    .setName('name')
                    .setDescription('テンプレート名')
                    .setRequired(true)
            )
    )
    .addSubcommand((sub) =>
        sub
            .setName('add')
            .setDescription('新しいテンプレートを登録します')
            .addStringOption((option) =>
                option
                    .setName('name')
                    .setDescription('テンプレート名')
                    .setRequired(true)
            )
            .addStringOption((option) =>
                option
                    .setName('prompt')
                    .setDescription('テンプレートのプロンプト内容')
                    .setRequired(true)
            )
    )
    .addSubcommand((sub) =>
        sub
            .setName('delete')
            .setDescription('テンプレートを削除します')
            .addStringOption((option) =>
                option
                    .setName('name')
                    .setDescription('削除するテンプレート名')
                    .setRequired(true)
            )
    );

/** /screenshot コマンド定義 */
const screenshotCommand = new SlashCommandBuilder()
    .setName('screenshot')
    .setDescription('Antigravityの現在の画面をキャプチャします');

/** /cdp コマンド定義 */
const cdpCommand = new SlashCommandBuilder()
    .setName('cdp')
    .setDescription('AntigravityとのCDP接続を管理します')
    .addSubcommand((sub) =>
        sub
            .setName('connect')
            .setDescription('Antigravityへ手動で接続します')
    )
    .addSubcommand((sub) =>
        sub
            .setName('status')
            .setDescription('現在のCDP接続ステータスを表示します')
    );

/** /workspace コマンド定義 */
const workspaceCommand = new SlashCommandBuilder()
    .setName('workspace')
    .setDescription('ワークスペース一覧を表示し、選択するとチャンネルを自動作成してバインドします');

/** /chat コマンド定義 */
const chatCommand = new SlashCommandBuilder()
    .setName('chat')
    .setDescription('Antigravityのチャットセッションを管理します')
    .addSubcommand((sub) =>
        sub
            .setName('new')
            .setDescription('新しいチャットセッションを開始します')
    )
    .addSubcommand((sub) =>
        sub
            .setName('status')
            .setDescription('現在のチャットセッション情報を表示します')
    )
    .addSubcommand((sub) =>
        sub
            .setName('list')
            .setDescription('同ワークスペースのチャットセッション一覧を表示します')
    );

/** 登録するコマンドの配列 */
export const slashCommands = [
    modeCommand,
    modelsCommand,
    templatesCommand,
    screenshotCommand,
    cdpCommand,
    workspaceCommand,
    chatCommand,
];

/**
 * Discord にスラッシュコマンドを登録する
 * @param token Botのトークン
 * @param clientId BotのアプリケーションID
 * @param guildId 登録先のギルド（サーバー）ID（省略時はグローバル登録）
 */
export async function registerSlashCommands(
    token: string,
    clientId: string,
    guildId?: string
): Promise<void> {
    const rest = new REST({ version: '10' }).setToken(token);

    const commandData = slashCommands.map((cmd) => cmd.toJSON());

    try {
        if (guildId) {
            // ギルド限定登録（即時反映）
            await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: commandData }
            );
            console.log(`✅ スラッシュコマンド ${commandData.length} 件をギルド ${guildId} に登録しました。`);
        } else {
            // グローバル登録（反映に最大1時間かかる）
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commandData }
            );
            console.log(`✅ スラッシュコマンド ${commandData.length} 件をグローバルに登録しました。`);
        }
    } catch (error) {
        console.error('❌ スラッシュコマンドの登録に失敗しました:', error);
        throw error;
    }
}
