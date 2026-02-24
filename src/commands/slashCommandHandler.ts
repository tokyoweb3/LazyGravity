import { t } from "../utils/i18n";
import { ModeService } from '../services/modeService';
import { ModelService } from '../services/modelService';
import { TemplateRepository } from '../database/templateRepository';

/**
 * Command execution result type definition
 */
export interface CommandResult {
    /** Whether execution succeeded (true on success, false on error or invalid arguments) */
    success: boolean;
    /** Message content to display to the user */
    message: string;
    /** Prompt retrieved from `/templates` (for subsequent task execution, if present) */
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
     * Parse the slash command name and arguments, then route to the appropriate handler
     */
    public async handleCommand(commandName: string, args: string[]): Promise<CommandResult> {
        switch (commandName.toLowerCase()) {
            case 'mode':
                return this.handleModeCommand(args);
            case 'model':
            case 'models': // backward compatibility
                return this.handleModelsCommand(args);
            case 'template':
            case 'templates': // backward compatibility
                return this.handleTemplatesCommand(args);
            default:
                return {
                    success: false,
                    message: t(`⚠️ Unknown command: /${commandName}`),
                };
        }
    }

    private handleModeCommand(args: string[]): CommandResult {
        if (args.length === 0) {
            const current = this.modeService.getCurrentMode();
            const available = this.modeService.getAvailableModes().join(', ');
            return {
                success: true,
                message: t(`⚙️ Current mode: **${current}**\nAvailable modes: ${available}\nTo change: \`/mode [mode_name]\``),
            };
        }

        const newMode = args[0];
        const result = this.modeService.setMode(newMode);

        if (result.success) {
            return {
                success: true,
                message: t(`✅ Mode changed to **${result.mode}**.`),
            };
        } else {
            return {
                success: false,
                message: result.error || t('⚠️ Invalid mode.'),
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
                    message: t('📝 No templates registered.'),
                };
            }

            const list = templates.map((t) => `- **${t.name}**`).join('\n');
            return {
                success: true,
                message: t(`📝 Registered Templates:\n${list}\n\nTo use: \`/templates [name]\``),
            };
        }

        const subCommandOrName = args[0];

        // add: register new template
        if (subCommandOrName.toLowerCase() === 'add') {
            if (args.length < 3) {
                return {
                    success: false,
                    message: t('⚠️ Missing arguments.\nUsage: `/templates add "name" "prompt"`'),
                };
            }
            const name = args[1];
            // Quotes already stripped by messageParser. Join remaining args as the prompt
            const prompt = args.slice(2).join(' ');

            try {
                this.templateRepo.create({ name, prompt });
                return {
                    success: true,
                    message: t(`✅ Template **${name}** registered.`),
                };
            } catch (e: any) {
                return {
                    success: false,
                    message: t(`⚠️ Failed to register template. Name might be duplicated.`),
                };
            }
        }

        // delete: remove template
        if (subCommandOrName.toLowerCase() === 'delete') {
            if (args.length < 2) {
                return {
                    success: false,
                    message: t('⚠️ Specify a template name to delete.\nUsage: `/templates delete "name"`'),
                };
            }
            const name = args[1];
            const deleted = this.templateRepo.deleteByName(name);
            if (deleted) {
                return {
                    success: true,
                    message: t(`🗑️ Template **${name}** deleted.`),
                };
            } else {
                return {
                    success: false,
                    message: t(`⚠️ Template **${name}** not found.`),
                };
            }
        }

        // Otherwise treat as template invocation
        const templateName = subCommandOrName;
        const template = this.templateRepo.findByName(templateName);

        if (!template) {
            return {
                success: false,
                message: t(`⚠️ Template **${templateName}** not found.`),
            };
        }

        return {
            success: true,
            message: t(`📝 Invoked template **${templateName}**.\nStarting process with this prompt.`),
            prompt: template.prompt,
        };
    }
}
