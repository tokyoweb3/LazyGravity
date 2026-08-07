export class ConsecutiveEmptyPollGate {
    private count: number = 0;
    
    constructor(private readonly requiredEmptyPolls: number = 3) {}
    
    recordDetection(): void {
        this.count = 0;
    }
    
    recordEmptyPoll(): boolean {
        this.count++;
        return this.count >= this.requiredEmptyPolls;
    }
    
    reset(): void {
        this.count = 0;
    }
}
