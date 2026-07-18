/**
 * Helper class to gate state transitions based on consecutive empty polls.
 */
export class ConsecutiveEmptyPollGate {
    private count: number = 0;
    
    /**
     * @param requiredEmptyPolls Number of empty polls required before gating.
     */
    constructor(private readonly requiredEmptyPolls: number = 3) {}
    
    /**
     * Resets the empty poll count upon successful detection.
     */
    recordDetection(): void {
        this.count = 0;
    }
    
    /**
     * Records a poll event where no changes were found.
     * @returns True if the consecutive empty poll threshold has been met/exceeded.
     */
    recordEmptyPoll(): boolean {
        this.count++;
        return this.count >= this.requiredEmptyPolls;
    }
    
    /**
     * Resets the poll counter back to zero.
     */
    reset(): void {
        this.count = 0;
    }
}
