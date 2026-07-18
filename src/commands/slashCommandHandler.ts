import { t } from "../utils/i18n";
import { TemplateRepository } from '../database/templateRepository';

/**
 * Command execution result type definition
 */
export interface CommandResult {
    /** Whether execution succeeded (true on success, false on error or invalid arguments) */
    success: boolean;
    /** Message content to display to the user */
    message: string;
    /** Prompt retrieved from `/template` (for subsequent task execution, if present) */
    prompt?: string;
}

/**
 * Handler parsing and processing slash commands.
 */
export class SlashCommandHandler {
    private templateRepo: TemplateRepository;

    /**
     * @param templateRepo The templates database repository.
     */
    constructor(templateRepo: TemplateRepository) {
        this.templateRepo = templateRepo;
    }

    /**
     * Parse the slash command name and arguments, then route to the appropriate handler.
     * @param commandName Trigger slash command name.
     * @param args Array of parsed parameters/arguments.
     * @returns Command execution result metadata.
     */
    public async handleCommand(commandName: string, args: string[]): Promise<CommandResult> {
        switch (commandName.toLowerCase()) {
            case 'template':
                return this.handleTemplateCommand(args);
            default:
                return {
                    success: false,
                    message: t(`⚠️ Unknown command: /${commandName}`),
                };
        }
    }

    /**
     * Internal template command handler logic.
     * @param args Parameter arguments list.
     * @returns Command execution result.
     */
    private handleTemplateCommand(args: string[]): CommandResult {
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
                message: t(`📝 Registered Templates:\n${list}\n\nTo use: \`/template [name]\``),
            };
        }

        const subCommandOrName = args[0];

        // add: register new template
        if (subCommandOrName.toLowerCase() === 'add') {
            if (args.length < 3) {
                return {
                    success: false,
                    message: t('⚠️ Missing arguments.\nUsage: `/template add "name" "prompt"`'),
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
                    message: t('⚠️ Specify a template name to delete.\nUsage: `/template delete "name"`'),
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
