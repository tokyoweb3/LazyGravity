import { QuestionDetector, QuestionInfo } from '../../src/services/questionDetector';
import { CdpService } from '../../src/services/cdpService';
import { Protocol } from 'devtools-protocol';

describe('QuestionDetector', () => {
    let mockCdpService: jest.Mocked<CdpService>;
    let detector: QuestionDetector;
    let mockOnQuestionDetected: jest.Mock;
    let mockOnResolved: jest.Mock;
    
    beforeEach(() => {
        mockCdpService = {
            isConnected: jest.fn().mockReturnValue(true),
            call: jest.fn(),
            getContexts: jest.fn().mockReturnValue([]),
            getPrimaryContextId: jest.fn().mockReturnValue(null),
        } as unknown as jest.Mocked<CdpService>;
        
        mockOnQuestionDetected = jest.fn();
        mockOnResolved = jest.fn();
        
        detector = new QuestionDetector({
            cdpService: mockCdpService,
            onQuestionRequired: mockOnQuestionDetected,
            onResolved: mockOnResolved,
            pollIntervalMs: 100, // fast for tests
        });
    });
    
    afterEach(() => {
        detector.stop();
        jest.clearAllMocks();
    });
    
    it('should ignore non-interactive Markdown lists in chat panels', async () => {
        // Mock a scenario where there is a Chat Panel with a "Submit" button at the bottom,
        // and a plain Markdown list inside a chat message.
        mockCdpService.call.mockResolvedValue({
            result: {
                value: {
                    detected: false,
                    reason: 'No targetList or submitBtn found',
                }
            }
        } as any);
        
        const result = await (detector as any).poll();
        
        // It should evaluate the script in the CDP
        expect(mockCdpService.call).toHaveBeenCalled();
        
        // It should NOT call onQuestionDetected because no true interactive options were found
        expect(mockOnQuestionDetected).not.toHaveBeenCalled();
    });

    it('should correctly detect interactive forms with proper roles', async () => {
        // Mock an interactive modal (with role="radio" items)
        mockCdpService.call.mockResolvedValue({
            result: {
                value: {
                    detected: true,
                    title: 'Which script are you referring to?',
                    options: ['Option A', 'Option B'],
                }
            }
        } as any);
        
        await (detector as any).poll();
        
        expect(mockOnQuestionDetected).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Which script are you referring to?',
            options: ['Option A', 'Option B']
        }));
    });
});
