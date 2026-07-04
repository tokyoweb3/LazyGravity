import { EventEmitter } from 'events';
import { CdpService } from './cdpService';
import { logger } from '../utils/logger';

export interface QuestionOption {
    text: string;
    x: number;
    y: number;
}

export interface QuestionInfo {
    title: string;
    description: string;
    options: QuestionOption[];
}

export interface QuestionDetectorOptions {
    cdpService: CdpService;
    pollIntervalMs?: number;
    onQuestionRequired: (info: QuestionInfo) => void;
    onResolved?: () => void;
}

export class QuestionDetector extends EventEmitter {
    private cdp: CdpService;
    private pollIntervalMs: number;
    private intervalId: NodeJS.Timeout | null = null;
    private logger = logger;
    private lastQuestionDetected: boolean = false;
    private emptyPollCount: number = 0;
    private static readonly REQUIRED_EMPTY_POLLS = 3;
    private _isStarted: boolean = false;
    private onQuestionRequired: (info: QuestionInfo) => void;
    private onResolved?: () => void;
    private projectName: string = 'unknown';

    constructor(options: QuestionDetectorOptions) {
        super();
        this.cdp = options.cdpService;
        this.pollIntervalMs = options.pollIntervalMs || 2000;
        this.onQuestionRequired = options.onQuestionRequired;
        this.onResolved = options.onResolved;
        
        // Listen to own events to call options callbacks (for compat)
        this.on('question', (info) => this.onQuestionRequired(info));
        this.on('resolved', () => {
            if (this.onResolved) this.onResolved();
        });
    }
    
    setProjectName(name: string) {
        this.projectName = name;
    }

    get isActive() {
        return this._isStarted;
    }

    start() {
        if (this._isStarted) return;
        this._isStarted = true;
        this.logger.debug(`[QuestionDetector:${this.projectName}] Starting polling`);
        this.lastQuestionDetected = false;
        this.emptyPollCount = 0;
        
        this.intervalId = setInterval(() => this.poll(), this.pollIntervalMs);
        this.poll();
    }

    stop() {
        if (!this._isStarted) return;
        this._isStarted = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.logger.debug(`[QuestionDetector:${this.projectName}] Stopped polling`);
    }

    async submitOption(index: number): Promise<boolean> {
        this.logger.debug(`[QuestionDetector:${this.projectName}] Submitting option ${index}`);
        
        try {
            const contextId = this.cdp.getPrimaryContextId();
            const callParams: any = {
                expression: `
                (() => {
                    const containers = Array.from(document.querySelectorAll('div, form, dialog')).reverse();
                    let targetList = null;
                    let submitBtn = null;
                    
                    for (const container of containers) {
                        const buttons = Array.from(container.querySelectorAll('button'));
                        let possibleSubmitBtn = null;
                        for (const btn of buttons) {
                            const text = btn.textContent?.toLowerCase() || '';
                            if (text.includes('submit') || text.includes('continue')) {
                                possibleSubmitBtn = btn;
                                break;
                            }
                        }
                        
                        if (possibleSubmitBtn) {
                            const items = Array.from(container.querySelectorAll('li, label, a, [role="radio"], [role="option"], [class*="cursor-pointer"]'))
                                .filter(el => el.tagName !== 'BUTTON' && !el.closest('button'));
                            
                            if (items.length > 1) {
                                targetList = container;
                                submitBtn = possibleSubmitBtn;
                                break;
                            }
                        }
                    }

                    if (!targetList || !submitBtn) return { found: false };

                    const items = Array.from(targetList.querySelectorAll('li, label, a, [role="radio"], [role="option"], [class*="cursor-pointer"]'))
                        .filter(el => el.tagName !== 'BUTTON' && !el.closest('button'));
                    if (items.length <= ${index}) return { found: false };
                    
                    const targetOption = items[${index}];
                    
                    const optionRect = targetOption.getBoundingClientRect();
                    const btnRect = submitBtn.getBoundingClientRect();
                    
                    return {
                        found: true,
                        option: {
                            x: Math.round(optionRect.left + optionRect.width / 2),
                            y: Math.round(optionRect.top + optionRect.height / 2)
                        },
                        button: {
                            x: Math.round(btnRect.left + btnRect.width / 2),
                            y: Math.round(btnRect.top + btnRect.height / 2)
                        }
                    };
                })()
                `,
                returnByValue: true,
                awaitPromise: false,
            };
            if (contextId !== null) {
                callParams.contextId = contextId;
            }

            const response = await this.cdp.call('Runtime.evaluate', callParams);
            const result = response?.result?.value;

            if (!result || !result.found) {
                this.logger.warn(`[QuestionDetector:${this.projectName}] Could not find question modal elements during submission.`);
                return false;
            }

            // Click the option
            await this.cdp.call('Input.dispatchMouseEvent', {
                type: 'mousePressed',
                x: result.option.x,
                y: result.option.y,
                button: 'left',
                clickCount: 1,
            });
            await this.cdp.call('Input.dispatchMouseEvent', {
                type: 'mouseReleased',
                x: result.option.x,
                y: result.option.y,
                button: 'left',
                clickCount: 1,
            });
            
            await new Promise(resolve => setTimeout(resolve, 50));

            // Click the submit button
            await this.cdp.call('Input.dispatchMouseEvent', {
                type: 'mousePressed',
                x: result.button.x,
                y: result.button.y,
                button: 'left',
                clickCount: 1,
            });
            await this.cdp.call('Input.dispatchMouseEvent', {
                type: 'mouseReleased',
                x: result.button.x,
                y: result.button.y,
                button: 'left',
                clickCount: 1,
            });

            this.lastQuestionDetected = false;
            return true;
        } catch (e: any) {
            this.logger.error(`[QuestionDetector:${this.projectName}] submitOption error:`, e.message);
            return false;
        }
    }

    async skipQuestion(): Promise<boolean> {
        this.logger.debug(`[QuestionDetector:${this.projectName}] Skipping question`);
        
        try {
            const contextId = this.cdp.getPrimaryContextId();
            const callParams: any = {
                expression: `
                (() => {
                    const containers = Array.from(document.querySelectorAll('div, form, dialog')).reverse();
                    let skipBtn = null;
                    
                    for (const container of containers) {
                        const items = Array.from(container.querySelectorAll('li, [role="radio"], [role="option"], .cursor-pointer'))
                            .filter(el => el.tagName !== 'BUTTON' && !el.closest('button'));
                        const hasList = items.length > 1;
                        
                        const buttons = Array.from(container.querySelectorAll('button'));
                        for (const btn of buttons) {
                            const text = btn.textContent?.toLowerCase() || '';
                            if (text.includes('skip') && hasList) {
                                skipBtn = btn;
                                break;
                            }
                        }
                        if (skipBtn) break;
                    }

                    if (!skipBtn) return { found: false };
                    
                    const btnRect = skipBtn.getBoundingClientRect();
                    return {
                        found: true,
                        button: {
                            x: Math.round(btnRect.left + btnRect.width / 2),
                            y: Math.round(btnRect.top + btnRect.height / 2)
                        }
                    };
                })()
                `,
                returnByValue: true,
                awaitPromise: false,
            };
            if (contextId !== null) callParams.contextId = contextId;

            const response = await this.cdp.call('Runtime.evaluate', callParams);
            const result = response?.result?.value;

            if (!result || !result.found) {
                this.logger.warn(`[QuestionDetector:${this.projectName}] Could not find skip button.`);
                return false;
            }

            await this.cdp.call('Input.dispatchMouseEvent', {
                type: 'mousePressed',
                x: result.button.x,
                y: result.button.y,
                button: 'left',
                clickCount: 1,
            });
            await this.cdp.call('Input.dispatchMouseEvent', {
                type: 'mouseReleased',
                x: result.button.x,
                y: result.button.y,
                button: 'left',
                clickCount: 1,
            });

            this.lastQuestionDetected = false;
            return true;
        } catch (e: any) {
            this.logger.error(`[QuestionDetector:${this.projectName}] skipQuestion error:`, e.message);
            return false;
        }
    }

    private async poll() {
        if (!this.cdp.isConnected()) return;

        try {
            const callParams: any = {
                expression: `
                (() => {
                    const containers = Array.from(document.querySelectorAll('div, form, dialog')).reverse();
                    let targetList = null;
                    let submitBtn = null;
                    
                    for (const container of containers) {
                        const buttons = Array.from(container.querySelectorAll('button'));
                        let possibleSubmitBtn = null;
                        for (const btn of buttons) {
                            const text = btn.textContent?.toLowerCase() || '';
                            if (text.includes('submit') || text.includes('continue')) {
                                possibleSubmitBtn = btn;
                                break;
                            }
                        }
                        
                        if (possibleSubmitBtn) {
                            const items = Array.from(container.querySelectorAll('li, label, a, [role="radio"], [role="option"], [class*="cursor-pointer"]'))
                                .filter(el => el.tagName !== 'BUTTON' && !el.closest('button'));
                            
                            if (items.length > 1) {
                                targetList = container;
                                submitBtn = possibleSubmitBtn;
                                break;
                            }
                        }
                    }
                    if (!targetList || !submitBtn) return { detected: false, reason: "No targetList or submitBtn found" };

                    let titleEl = targetList.querySelector('h1, h2, h3, [role="heading"], .text-lg');
                    if (!titleEl) {
                        let p = targetList;
                        while (p && p.tagName !== 'BODY') {
                            titleEl = p.querySelector('h1, h2, h3, [role="heading"], .text-lg, p');
                            if (titleEl && titleEl !== p && (titleEl.innerText || titleEl.textContent || '').trim().length > 0) break;
                            p = p.parentElement;
                        }
                    }
                    const title = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : 'Question';
                    
                    const items = Array.from(targetList.querySelectorAll('li, label, a, [role="radio"], [role="option"], [class*="cursor-pointer"]'))
                        .filter(el => el.tagName !== 'BUTTON' && !el.closest('button'));
                    const options = items.map(n => {
                        const rect = n.getBoundingClientRect();
                        const finalLabel = n.innerText || n.textContent || 'Option';

                        return {
                            text: finalLabel.replace(/\\n/g, ' ').replace(/\\s+/g, ' ').trim().substring(0, 100),
                            x: Math.round(rect.left + rect.width / 2),
                            y: Math.round(rect.top + rect.height / 2)
                        };
                    });

                    if (options.length === 0) return { detected: false, reason: "options length 0" };

                    return {
                        detected: true,
                        title,
                        options
                    };
                })()
                `,
                returnByValue: true,
                awaitPromise: false,
            };

            const contexts = this.cdp.getContexts();
            const contextIds = [
                this.cdp.getPrimaryContextId(),
                ...contexts.map((ctx) => ctx.id),
            ].filter((value, index, arr): value is number => typeof value === 'number' && arr.indexOf(value) === index);
            const targets: Array<number | null> = contextIds.length > 0 ? contextIds : [null];

            let detectedResult = null;
            let lastReason = null;

            for (const contextId of targets) {
                if (contextId !== null) {
                    callParams.contextId = contextId;
                }
                const response = await this.cdp.call('Runtime.evaluate', callParams).catch(e => {
                    this.logger.debug(`[QuestionDetector] Error evaluating on ctx ${contextId}: ${e.message}`);
                    return null;
                });
                
                if (response?.exceptionDetails) {
                    this.logger.debug(`[QuestionDetector] Exception on ctx ${contextId}: ${response.exceptionDetails.exception?.description || response.exceptionDetails.text}`);
                }

                const result = response?.result?.value;
                if (result) {
                    this.logger.debug(`[QuestionDetector] Context ${contextId} evaluated successfully, detected: ${result.detected}, reason: ${result.reason}`);
                }

                if (result && result.detected) {
                    detectedResult = result;
                    break;
                } else if (result && result.reason) {
                    lastReason = result.reason;
                }
            }

            const result = detectedResult;

            if (result && result.detected) {
                this.emptyPollCount = 0;
                if (!this.lastQuestionDetected) {
                    this.lastQuestionDetected = true;
                    this.logger.debug(`[QuestionDetector:${this.projectName}] Question modal detected`);
                    this.emit('question', {
                        title: result.title || 'Question',
                        description: 'Please answer the question below.',
                        options: result.options,
                    });
                }
            } else {
                if (!result && lastReason) {
                    this.logger.debug(`[QuestionDetector:${this.projectName}] Evaluate returned false: ${lastReason}`);
                }
                this.emptyPollCount++;
                if (this.emptyPollCount >= QuestionDetector.REQUIRED_EMPTY_POLLS) {
                    if (this.lastQuestionDetected) {
                        this.logger.debug(`[QuestionDetector:${this.projectName}] Question modal disappeared`);
                        this.lastQuestionDetected = false;
                        this.emit('resolved');
                    }
                }
            }
        } catch (e: any) {
            if (e.message?.includes('Target closed') || e.message?.includes('Session closed')) {
                // Ignore disconnect errors
            } else {
                this.logger.error(`[QuestionDetector:${this.projectName}] Error:`, e.message);
            }
        }
    }
}
