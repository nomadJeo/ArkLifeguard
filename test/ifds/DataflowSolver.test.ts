import path from 'node:path';
import { describe, expect, it } from 'vitest';
import 'arkanalyzer';
import {
    ArkMethod,
    Scene,
    SceneConfig,
    Stmt,
} from '../../src/adapter/arkanalyzer';
import {
    DataflowProblem,
    DataflowSolver,
    FlowFunction,
    PathEdge,
    PathEdgePoint,
} from '../../src/ifds';

class IdentityFlowFunction implements FlowFunction<string> {
    getDataFacts(fact: string): Set<string> {
        return new Set([fact]);
    }
}

class IdentityProblem extends DataflowProblem<string> {
    private readonly identity = new IdentityFlowFunction();

    constructor(
        private readonly entryPoint: Stmt,
        private readonly entryMethod: ArkMethod
    ) {
        super();
    }

    getNormalFlowFunction(_srcStmt: Stmt, _tgtStmt: Stmt): FlowFunction<string> {
        return this.identity;
    }

    getCallFlowFunction(_srcStmt: Stmt, _method: ArkMethod): FlowFunction<string> {
        return this.identity;
    }

    getExitToReturnFlowFunction(
        _srcStmt: Stmt,
        _tgtStmt: Stmt,
        _callStmt: Stmt
    ): FlowFunction<string> {
        return this.identity;
    }

    getCallToReturnFlowFunction(
        _srcStmt: Stmt,
        _tgtStmt: Stmt,
        _callees?: ReadonlySet<ArkMethod>
    ): FlowFunction<string> {
        return this.identity;
    }

    createZeroValue(): string {
        return 'ZERO';
    }

    getEntryPoint(): Stmt {
        return this.entryPoint;
    }

    getEntryMethod(): ArkMethod {
        return this.entryMethod;
    }

    factEqual(left: string, right: string): boolean {
        return left === right;
    }
}

class IdentitySolver extends DataflowSolver<string> {
    enqueueForTest(edge: PathEdge<string>, deferred = false): boolean {
        return this.propagate(edge, deferred);
    }

    drainForTest(): PathEdge<string>[] {
        const result: PathEdge<string>[] = [];
        while (this.hasPendingEdge()) result.push(this.takeNextEdge()!);
        return result;
    }
}

class SummaryPropagationSolver extends IdentitySolver {
    constructor(
        problem: IdentityProblem,
        scene: Scene,
        private readonly returnSite: Stmt,
        private readonly callerEntry: Stmt
    ) {
        super(problem, scene);
    }

    addIncomingForTest(
        calleeEntry: PathEdgePoint<string>,
        callerEdge: PathEdge<string>
    ): void {
        this.summaryStore.addIncoming(calleeEntry, callerEdge);
    }

    processExitForTest(edge: PathEdge<string>): void {
        this.processExitNode(edge);
    }

    protected getReturnSiteOfCall(): Stmt {
        return this.returnSite;
    }

    protected getStartOfCallerMethod(): Stmt {
        return this.callerEntry;
    }
}

interface SemanticFact {
    value: string;
}

class SemanticIdentityFlowFunction implements FlowFunction<SemanticFact> {
    getDataFacts(fact: SemanticFact): Set<SemanticFact> {
        return new Set([fact]);
    }
}

class SemanticIdentityProblem extends DataflowProblem<SemanticFact> {
    private readonly identity = new SemanticIdentityFlowFunction();

    constructor(
        private readonly entryPoint: Stmt,
        private readonly entryMethod: ArkMethod
    ) {
        super();
    }

    getNormalFlowFunction(): FlowFunction<SemanticFact> {
        return this.identity;
    }

    getCallFlowFunction(): FlowFunction<SemanticFact> {
        return this.identity;
    }

    getExitToReturnFlowFunction(): FlowFunction<SemanticFact> {
        return this.identity;
    }

    getCallToReturnFlowFunction(): FlowFunction<SemanticFact> {
        return this.identity;
    }

    createZeroValue(): SemanticFact {
        return { value: 'ZERO' };
    }

    getEntryPoint(): Stmt {
        return this.entryPoint;
    }

    getEntryMethod(): ArkMethod {
        return this.entryMethod;
    }

    factEqual(left: SemanticFact, right: SemanticFact): boolean {
        return left.value === right.value;
    }

    factHash(fact: SemanticFact): number {
        return fact.value.length;
    }
}

class SemanticIdentitySolver extends DataflowSolver<SemanticFact> {
    enqueueForTest(edge: PathEdge<SemanticFact>): boolean {
        return this.propagate(edge);
    }
}

function buildScene(): Scene {
    const projectPath = path.resolve(
        __dirname,
        '../fixtures/ifds/normal-flow'
    );
    const config = new SceneConfig();
    config.buildConfig('ifds-normal-flow', projectPath, []);
    config.buildFromProjectDir(projectPath);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

describe('IFDS migration smoke tests', () => {
    it('keeps path edge endpoints and facts', () => {
        const node = {} as Stmt;
        const start = new PathEdgePoint(node, 'ZERO');
        const end = new PathEdgePoint(node, 'FACT');
        const edge = new PathEdge(start, end);

        expect(edge.edgeStart).toBe(start);
        expect(edge.edgeEnd).toBe(end);
        expect(edge.edgeEnd.fact).toBe('FACT');
    });

    it('propagates an identity fact over an ordinary CFG', () => {
        const scene = buildScene();
        const method = scene.getMethods().find(candidate => candidate.getName() === 'run');
        expect(method).toBeDefined();
        const cfg = method!.getCfg();
        expect(cfg).toBeDefined();

        const problem = new IdentityProblem(cfg!.getStartingStmt(), method!);
        const solver = new IdentitySolver(problem, scene);
        solver.solve();

        const reachedStatements = new Set(
            [...solver.getPathEdgeSet()].map(edge => edge.edgeEnd.node)
        );
        for (const stmt of cfg!.getStmts()) {
            expect(reachedStatements.has(stmt), stmt.toString()).toBe(true);
        }
    });

    it('prioritizes immediate FIFO work over deferred LIFO work', () => {
        const node = {} as Stmt;
        const solver = new IdentitySolver(
            new IdentityProblem(node, {} as ArkMethod),
            new Scene(),
            { collectStatistics: true }
        );
        const edge = (fact: string): PathEdge<string> => new PathEdge(
            new PathEdgePoint(node, 'START'),
            new PathEdgePoint(node, fact)
        );

        expect(solver.enqueueForTest(edge('I1'))).toBe(true);
        expect(solver.enqueueForTest(edge('I2'))).toBe(true);
        expect(solver.enqueueForTest(edge('D1'), true)).toBe(true);
        expect(solver.enqueueForTest(edge('D2'), true)).toBe(true);
        expect(solver.enqueueForTest(edge('D2'), true)).toBe(false);

        expect(solver.drainForTest().map(item => item.edgeEnd.fact)).toEqual([
            'I1', 'I2', 'D2', 'D1',
        ]);
        expect(solver.getStatistics()).toMatchObject({
            scheduling: 'two-tier-control-flow',
            propagationAttempts: 5,
            deferredPropagationAttempts: 3,
            uniqueEdgesEnqueued: 4,
            duplicateEdgesSkipped: 1,
            deferredDuplicateEdgesSkipped: 1,
            deduplicationLookups: 5,
            deduplicationCandidateChecks: 10,
            immediateEnqueued: 2,
            deferredEnqueued: 2,
            maxCombinedQueueSize: 4,
            maxLaterEdgesSize: 0,
            finalLaterEdgesSize: 0,
        });
    });

    it('keeps statistics disabled by default', () => {
        const node = {} as Stmt;
        const solver = new IdentitySolver(
            new IdentityProblem(node, {} as ArkMethod),
            new Scene()
        );
        expect(solver.getStatistics()).toBeUndefined();
    });

    it('applies a new summary to every existing caller context', () => {
        const callerEntry = {} as Stmt;
        const callSite = {} as Stmt;
        const calleeEntry = {} as Stmt;
        const exit = {} as Stmt;
        const returnSite = {} as Stmt;
        const problem = new IdentityProblem(callerEntry, {} as ArkMethod);
        const solver = new SummaryPropagationSolver(
            problem,
            new Scene(),
            returnSite,
            callerEntry
        );
        const calleeStart = new PathEdgePoint(calleeEntry, 'CALLEE_INPUT');
        const callerEdge = (context: string): PathEdge<string> => new PathEdge(
            new PathEdgePoint(callerEntry, context),
            new PathEdgePoint(callSite, 'CALL_INPUT')
        );

        solver.addIncomingForTest(calleeStart, callerEdge('CONTEXT_1'));
        solver.addIncomingForTest(calleeStart, callerEdge('CONTEXT_2'));
        solver.processExitForTest(new PathEdge(
            calleeStart,
            new PathEdgePoint(exit, 'RETURN_FACT')
        ));

        const returnedContexts = [...solver.getPathEdgeSet()]
            .filter(edge => edge.edgeEnd.node === returnSite)
            .map(edge => edge.edgeStart.fact)
            .sort();
        expect(returnedContexts).toEqual(['CONTEXT_1', 'CONTEXT_2']);
    });

    it('deduplicates semantic facts and resolves hash collisions in the bucket', () => {
        const node = {} as Stmt;
        const solver = new SemanticIdentitySolver(
            new SemanticIdentityProblem(node, {} as ArkMethod),
            new Scene(),
            { collectStatistics: true }
        );
        const edge = (value: string): PathEdge<SemanticFact> => new PathEdge(
            new PathEdgePoint(node, { value: 'ROOT' }),
            new PathEdgePoint(node, { value })
        );

        expect(solver.enqueueForTest(edge('AA'))).toBe(true);
        expect(solver.enqueueForTest(edge('AA'))).toBe(false);
        // AA and BB intentionally share a hash; factEqual must distinguish them.
        expect(solver.enqueueForTest(edge('BB'))).toBe(true);
        expect(solver.enqueueForTest(edge('CC'))).toBe(true);

        expect(solver.getPathEdgeSet()).toHaveLength(3);
        expect(solver.getStatistics()).toMatchObject({
            propagationAttempts: 4,
            uniqueEdgesEnqueued: 3,
            duplicateEdgesSkipped: 1,
            deduplicationLookups: 4,
            deduplicationCandidateChecks: 4,
            maxDeduplicationCandidates: 2,
            factEqualityChecks: 5,
        });
    });
});
