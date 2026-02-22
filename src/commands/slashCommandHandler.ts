import { ModeService } from '../services/modeService';
import { ModelService } from '../services/modelService';
import { TemplateRepository } from '../database/templateRepository';

/**
 * コマンド実行結果の型定義
 */
export interface CommandResult {
    /** 実行が成功したか（成功時は true, エラー時や無効な引数の時は false） */
    success: boolean;
    /** ユーザーに表示するメッセージ内容 */
    message: string;
    /** `/templates` で取得したプロンプト（後続のタスク実行用・存在する場合のみ） */
    prompt?: string;
}

export class SlashCommandHandler {
    private modeService: ModeService;
    private modelService: ModelService;
    private templateRepo: TemplateRepository;

    constructor(
        modeService: ModeService,
        modelService: ModelService,
        templateRepo: TemplateRepository
    ) {
        this.modeService = modeService;
        this.modelService = modelService;
        this.templateRepo = templateRepo;
    }

    /**
     * スラッシュコマンド名と引数をパースして処理をルーティングする
     */
    public async handleCommand(commandName: string, args: string[]): Promise<CommandResult> {
        switch (commandName.toLowerCase()) {
            case 'mode':
                return this.handleModeCommand(args);
            case 'models':
                return this.handleModelsCommand(args);
            case 'templates':
                return this.handleTemplatesCommand(args);
            default:
                return {
                    success: false,
                    message: `⚠️ 未知のコマンドです: /${commandName}`,
                };
        }
    }

    private handleModeCommand(args: string[]): CommandResult {
        if (args.length === 0) {
            const current = this.modeService.getCurrentMode();
            const available = this.modeService.getAvailableModes().join(', ');
            return {
                success: true,
                message: `⚙️ 現在のモード: **${current}**\n利用可能なモード: ${available}\n変更方法: \`/mode [mode_name]\``,
            };
        }

        const newMode = args[0];
        const result = this.modeService.setMode(newMode);

        if (result.success) {
            return {
                success: true,
                message: `✅ モードを **${result.mode}** に変更しました。`,
            };
        } else {
            return {
                success: false,
                message: result.error || '⚠️ 無効なモードです。',
            };
        }
    }

    private handleModelsCommand(args: string[]): CommandResult {
        // Now handled by index.ts directly to use CDP
        return { success: false, message: 'This should not be reached.' };
    }

    private handleTemplatesCommand(args: string[]): CommandResult {
        if (args.length === 0) {
            const templates = this.templateRepo.findAll();
            if (templates.length === 0) {
                return {
                    success: true,
                    message: '📝 登録されているテンプレートはありません。',
                };
            }

            const list = templates.map((t) => `- **${t.name}**`).join('\n');
            return {
                success: true,
                message: `📝 登録済みテンプレート一覧:\n${list}\n\n呼び出し方法: \`/templates [テンプレート名]\``,
            };
        }

        const subCommandOrName = args[0];

        // add: 新規登録
        if (subCommandOrName.toLowerCase() === 'add') {
            if (args.length < 3) {
                return {
                    success: false,
                    message: '⚠️ 引数が不足しています。\n使用方法: `/templates add "テンプレート名" "プロンプト"`',
                };
            }
            const name = args[1];
            // messageParser側でクォート除去済み。以降の引数を結合してプロンプトとする
            const prompt = args.slice(2).join(' ');

            try {
                this.templateRepo.create({ name, prompt });
                return {
                    success: true,
                    message: `✅ テンプレート「**${name}**」を登録しました。`,
                };
            } catch (e: any) {
                return {
                    success: false,
                    message: `⚠️ テンプレートの登録に失敗しました。名前が重複している可能性があります。`,
                };
            }
        }

        // delete: 削除
        if (subCommandOrName.toLowerCase() === 'delete') {
            if (args.length < 2) {
                return {
                    success: false,
                    message: '⚠️ 削除するテンプレート名を指定してください。\n使用方法: `/templates delete "テンプレート名"`',
                };
            }
            const name = args[1];
            const deleted = this.templateRepo.deleteByName(name);
            if (deleted) {
                return {
                    success: true,
                    message: `🗑️ テンプレート「**${name}**」を削除しました。`,
                };
            } else {
                return {
                    success: false,
                    message: `⚠️ テンプレート「**${name}**」は見つかりません。`,
                };
            }
        }

        // それ以外はテンプレートの呼び出しとして扱う
        const templateName = subCommandOrName;
        const template = this.templateRepo.findByName(templateName);

        if (!template) {
            return {
                success: false,
                message: `⚠️ テンプレート「**${templateName}**」は見つかりません。`,
            };
        }

        return {
            success: true,
            message: `📝 テンプレート「**${templateName}**」を呼び出しました。\nこのプロンプトで処理を開始します。`,
            prompt: template.prompt,
        };
    }
}
