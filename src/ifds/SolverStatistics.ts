export interface DataflowSolverOptions {
    /** Collect low-overhead aggregate solver statistics. Disabled by default. */
    collectStatistics?: boolean;
}

export interface IFDSSolverStatistics {
    scheduling: 'later-edge-worklist' | 'two-tier-control-flow';
    solveTimeMs: number;
    propagationAttempts: number;
    deferredPropagationAttempts: number;
    uniqueEdgesEnqueued: number;
    duplicateEdgesSkipped: number;
    deferredDuplicateEdgesSkipped: number;
    processedEdges: number;
    immediateEnqueued: number;
    deferredEnqueued: number;
    maxImmediateQueueSize: number;
    maxDeferredQueueSize: number;
    maxCombinedQueueSize: number;
    maxLaterEdgesSize: number;
    finalLaterEdgesSize: number;
    finalPathEdgeCount: number;
}

export function createSolverStatistics(
    scheduling: IFDSSolverStatistics['scheduling']
): IFDSSolverStatistics {
    return {
        scheduling,
        solveTimeMs: 0,
        propagationAttempts: 0,
        deferredPropagationAttempts: 0,
        uniqueEdgesEnqueued: 0,
        duplicateEdgesSkipped: 0,
        deferredDuplicateEdgesSkipped: 0,
        processedEdges: 0,
        immediateEnqueued: 0,
        deferredEnqueued: 0,
        maxImmediateQueueSize: 0,
        maxDeferredQueueSize: 0,
        maxCombinedQueueSize: 0,
        maxLaterEdgesSize: 0,
        finalLaterEdgesSize: 0,
        finalPathEdgeCount: 0,
    };
}
