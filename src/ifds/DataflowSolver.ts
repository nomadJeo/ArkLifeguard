/*
 * Copyright (c) 2024-2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
    ArkInvokeStmt,
    ArkMethod,
    Scene,
    Stmt,
    ArkThrowStmt,
} from '../adapter/arkanalyzer';
import { DataflowProblem } from './DataflowProblem';
import { ArkInterproceduralCFG } from './icfg/ArkInterproceduralCFG';
import type { InterproceduralCFG } from './icfg/InterproceduralCFG';
import { PathEdge, PathEdgePoint } from './PathEdge';
import { PathEdgeStore } from './PathEdgeStore';
import { SummaryStore } from './SummaryStore';
import { createSolverStatistics, DataflowSolverOptions, IFDSSolverStatistics } from './SolverStatistics';

/*
 * This program is roughly an implementation of the paper:
 * Practical Extensions to the IFDS Algorithm.
 */
export abstract class DataflowSolver<D> {
    protected problem: DataflowProblem<D>;
    protected zeroFact: D;
    private readonly icfg: InterproceduralCFG;
    protected readonly pathEdgeStore: PathEdgeStore<D>;
    protected readonly summaryStore: SummaryStore<D>;
    private immediateWorkList: Array<PathEdge<D>>;
    private immediateWorkListHead = 0;
    private deferredWorkList: Array<PathEdge<D>>;
    private readonly statistics?: IFDSSolverStatistics;

    constructor(
        problem: DataflowProblem<D>,
        scene: Scene,
        options: DataflowSolverOptions = {},
        icfg: InterproceduralCFG = new ArkInterproceduralCFG(scene)
    ) {
        this.problem = problem;
        this.zeroFact = problem.createZeroValue();
        this.immediateWorkList = [];
        this.deferredWorkList = [];
        this.pathEdgeStore = new PathEdgeStore(problem);
        this.summaryStore = new SummaryStore(problem);
        this.icfg = icfg;
        if (options.collectStatistics) {
            this.statistics = createSolverStatistics('two-tier-control-flow');
        }
    }

    public solve(): void {
        const startTime = Date.now();
        this.init();
        this.doSolve();
        if (this.statistics) {
            this.statistics.solveTimeMs = Date.now() - startTime;
            this.statistics.finalPathEdgeCount = this.pathEdgeStore.size;
        }
    }

    protected computeResult(stmt: Stmt, d: D): boolean {
        return this.pathEdgeStore.containsEndPoint(stmt, d);
    }

    protected init(): void {
        this.summaryStore.clear();
        const edgePoint = new PathEdgePoint<D>(this.problem.getEntryPoint(), this.zeroFact);
        const edge = new PathEdge<D>(edgePoint, edgePoint);
        this.propagate(edge);

        this.icfg.initialize(this.problem.getEntryMethod());
    }

    private recordDeduplicationLookup(candidateChecks: number, factEqualityChecks: number): void {
        if (!this.statistics) return;
        this.statistics.deduplicationLookups++;
        this.statistics.deduplicationCandidateChecks += candidateChecks;
        this.statistics.factEqualityChecks += factEqualityChecks;
        this.statistics.maxDeduplicationCandidates = Math.max(this.statistics.maxDeduplicationCandidates, candidateChecks);
    }

    /** Normalize or reject an edge before semantic deduplication and scheduling. */
    protected prepareEdgeForPropagation(edge: PathEdge<D>): PathEdge<D> | null {
        return edge;
    }

    /**
     * Atomically deduplicate and enqueue an edge. Immediate edges are FIFO;
     * deferred normal-flow edges are LIFO and run only after immediate work.
     */
    protected propagate(edge: PathEdge<D>, deferred = false): boolean {
        if (this.statistics) {
            this.statistics.propagationAttempts++;
            if (deferred) this.statistics.deferredPropagationAttempts++;
        }
        const prepared = this.prepareEdgeForPropagation(edge);
        if (!prepared) return false;
        const insertion = this.pathEdgeStore.addIfAbsent(prepared);
        this.recordDeduplicationLookup(insertion.candidateChecks, insertion.factEqualityChecks);
        if (!insertion.inserted) {
            if (this.statistics) {
                this.statistics.duplicateEdgesSkipped++;
                if (deferred) this.statistics.deferredDuplicateEdgesSkipped++;
            }
            return false;
        }

        if (deferred) {
            this.deferredWorkList.push(prepared);
        } else {
            this.immediateWorkList.push(prepared);
        }
        if (this.statistics) {
            this.statistics.uniqueEdgesEnqueued++;
            if (deferred) {
                this.statistics.deferredEnqueued++;
            } else {
                this.statistics.immediateEnqueued++;
            }
            this.updateQueuePeaks();
        }
        return true;
    }

    private updateQueuePeaks(): void {
        if (!this.statistics) return;
        const immediate = this.immediateWorkList.length - this.immediateWorkListHead;
        const deferred = this.deferredWorkList.length;
        this.statistics.maxImmediateQueueSize = Math.max(this.statistics.maxImmediateQueueSize, immediate);
        this.statistics.maxDeferredQueueSize = Math.max(this.statistics.maxDeferredQueueSize, deferred);
        this.statistics.maxCombinedQueueSize = Math.max(this.statistics.maxCombinedQueueSize, immediate + deferred);
    }

    protected processExitNode(edge: PathEdge<D>): void {
        if (edge.edgeEnd.node instanceof ArkThrowStmt) {
            this.processExceptionalExit(edge.edgeStart, edge.edgeEnd);
            return;
        }
        const startEdgePoint = edge.edgeStart;
        const exitEdgePoint = edge.edgeEnd;
        this.summaryStore.addEndSummary(startEdgePoint, exitEdgePoint);
        const callerEdges = this.summaryStore.getIncoming(startEdgePoint);
        if (callerEdges === undefined) {
            if (this.isRootMethod(startEdgePoint.node.getCfg()!.getDeclaringMethod())) {
                return;
            }
            throw new Error('incoming does not have ' + startEdgePoint.node.getCfg()?.getDeclaringMethod().toString());
        }
        for (const callerEdge of callerEdges) {
            const callEdgePoint = callerEdge.edgeEnd;
            const returnSite = this.icfg.getReturnSiteOfCallAt(callEdgePoint.node);
            if (!returnSite) continue;
            const returnFlowFunc = this.problem.getExitToReturnFlowFunction(exitEdgePoint.node, returnSite, callEdgePoint.node);
            for (const fact of returnFlowFunc.getDataFacts(exitEdgePoint.fact)) {
                const returnSitePoint = new PathEdgePoint<D>(returnSite, fact);
                if (!this.summaryStore.addCallSummary(callEdgePoint, returnSitePoint)) continue;
                this.applySummaryToIncomingCallers(callerEdges, callEdgePoint, returnSitePoint);
            }
        }
    }

    protected isRootMethod(method: ArkMethod): boolean {
        return method === this.problem.getEntryMethod();
    }

    private processExceptionalExit(methodEntryPoint: PathEdgePoint<D>, exceptionalExitPoint: PathEdgePoint<D>): void {
        if (!this.summaryStore.addExceptionalEndSummary(methodEntryPoint, exceptionalExitPoint)) {
            return;
        }
        const callerEdges = this.summaryStore.getIncoming(methodEntryPoint);
        if (!callerEdges) return;

        for (const callerEdge of callerEdges) {
            this.applyExceptionalSummaryToCaller(callerEdges, callerEdge, exceptionalExitPoint);
        }
    }

    private applyExceptionalSummaryToCaller(callerEdges: ReadonlySet<PathEdge<D>>, callerEdge: PathEdge<D>, exceptionalExitPoint: PathEdgePoint<D>): void {
        const callEdgePoint = callerEdge.edgeEnd;
        const handlers = this.icfg.getExceptionalReturnSitesOfCallAt(callEdgePoint.node);
        if (handlers.length === 0) {
            // No handler in this method: retain the original throw site and payload
            // while moving the exceptional completion one stack frame outwards.
            this.processExceptionalExit(callerEdge.edgeStart, exceptionalExitPoint);
            return;
        }

        for (const handler of handlers) {
            const handlerTarget = this.icfg.getHandlerContinuation(handler);
            const exitFlow = this.problem.getExceptionalExitToReturnFlowFunction(exceptionalExitPoint.node, handler, callEdgePoint.node);
            this.addExceptionalCallSummaries(callerEdges, callEdgePoint, handlerTarget, exitFlow.getDataFacts(exceptionalExitPoint.fact));

            const callerFlow = this.problem.getCallToExceptionalReturnFlowFunction(callEdgePoint.node, handler);
            this.addExceptionalCallSummaries(callerEdges, callEdgePoint, handlerTarget, callerFlow.getDataFacts(callEdgePoint.fact));
        }
    }

    private addExceptionalCallSummaries(callerEdges: ReadonlySet<PathEdge<D>>, callEdgePoint: PathEdgePoint<D>, handler: Stmt, facts: Iterable<D>): void {
        for (const fact of facts) {
            const handlerPoint = new PathEdgePoint(handler, fact);
            if (!this.summaryStore.addCallSummary(callEdgePoint, handlerPoint)) {
                continue;
            }
            this.applySummaryToIncomingCallers(callerEdges, callEdgePoint, handlerPoint);
        }
    }

    protected applySummaryToIncomingCallers(callerEdges: ReadonlySet<PathEdge<D>>, callEdgePoint: PathEdgePoint<D>, returnSitePoint: PathEdgePoint<D>): void {
        const startOfCaller = this.icfg.getStartPointOfCaller(callEdgePoint.node);
        if (!startOfCaller) throw new Error('caller method has no start point');
        for (const callerEdge of callerEdges) {
            if (callerEdge.edgeEnd.node !== callEdgePoint.node || !this.problem.factEqual(callerEdge.edgeEnd.fact, callEdgePoint.fact)) continue;
            if (callerEdge.edgeStart.node !== startOfCaller) continue;
            this.propagate(new PathEdge<D>(callerEdge.edgeStart, returnSitePoint));
        }
    }

    protected processNormalNode(edge: PathEdge<D>): void {
        const start = edge.edgeStart;
        const end = edge.edgeEnd;

        const normalChildren = end.node instanceof ArkThrowStmt
            ? []
            : this.icfg.getNormalSuccessors(end.node);
        for (const stmt of [...normalChildren].reverse()) {
            const flowFunction = this.problem.getNormalFlowFunction(end.node, stmt);
            const set = flowFunction.getDataFacts(end.fact);
            for (const fact of set) {
                const edgePoint = new PathEdgePoint<D>(stmt, fact);
                const nextEdge = new PathEdge<D>(start, edgePoint);
                this.propagate(nextEdge, true);
            }
        }

        const exceptionalChildren = this.icfg.getExceptionalSuccessors(end.node);
        for (const handler of [...exceptionalChildren].reverse()) {
            const handlerTarget = this.icfg.getHandlerContinuation(handler);
            const flowFunction = this.problem.getExceptionalFlowFunction(end.node, handler);
            for (const fact of flowFunction.getDataFacts(end.fact)) {
                this.propagate(new PathEdge(start, new PathEdgePoint(handlerTarget, fact)), true);
            }
        }

        if (this.icfg.mayThrow(end.node) && exceptionalChildren.length === 0) {
            this.processExceptionalExit(start, end);
        }
    }

    protected processCallNode(edge: PathEdge<D>): void {
        const start = edge.edgeStart;
        const callEdgePoint = edge.edgeEnd;
        const returnSite = this.icfg.getReturnSiteOfCallAt(callEdgePoint.node);
        const handlers = this.icfg.getExceptionalReturnSitesOfCallAt(callEdgePoint.node);
        if (!returnSite && handlers.length === 0) return;
        const invokeStmt = callEdgePoint.node as ArkInvokeStmt;
        const callees = this.icfg.getCalleesOfCallAt(invokeStmt);
        for (const callee of callees) {
            const callFlowFunc = this.problem.getCallFlowFunction(invokeStmt, callee);
            if (!callee.getCfg()) {
                continue;
            }
            const firstStmt = this.icfg.getStartPointOf(callee);
            if (!firstStmt) continue;
            const facts = callFlowFunc.getDataFacts(callEdgePoint.fact);
            for (const fact of facts) {
                this.callNodeFactPropagate(edge, firstStmt, fact, returnSite ?? undefined);
            }
        }
        if (returnSite) {
            const callToReturnflowFunc = this.problem.getCallToReturnFlowFunction(edge.edgeEnd.node, returnSite, callees);
            const set = callToReturnflowFunc.getDataFacts(callEdgePoint.fact);
            for (const fact of set) {
                this.propagate(new PathEdge<D>(start, new PathEdgePoint<D>(returnSite, fact)));
            }
            this.replayCallSummaries(start, callEdgePoint, returnSite);
        }

        // Calls may fail before a callee body is entered (for example a null
        // receiver), and unresolved/library calls have no callee exit summary.
        for (const handler of handlers) {
            const handlerTarget = this.icfg.getHandlerContinuation(handler);
            const exceptionalFlow = this.problem.getCallToExceptionalReturnFlowFunction(callEdgePoint.node, handler, callees);
            for (const fact of exceptionalFlow.getDataFacts(callEdgePoint.fact)) {
                this.propagate(new PathEdge(start, new PathEdgePoint(handlerTarget, fact)));
            }
            this.replayCallSummaries(start, callEdgePoint, handlerTarget);
        }

        if (handlers.length === 0) {
            this.processExceptionalExit(start, callEdgePoint);
        }
    }

    private replayCallSummaries(start: PathEdgePoint<D>, callPoint: PathEdgePoint<D>, target: Stmt): void {
        for (const summaryPoint of this.summaryStore.getCallSummaries(callPoint, target)) {
            this.propagate(new PathEdge(start, summaryPoint));
        }
    }

    protected callNodeFactPropagate(edge: PathEdge<D>, firstStmt: Stmt, fact: D, returnSite?: Stmt): void {
        const callEdgePoint = edge.edgeEnd;
        const startEdgePoint = this.createCalleeStartPoint(firstStmt, fact);
        this.propagate(new PathEdge<D>(startEdgePoint, startEdgePoint));
        this.summaryStore.addIncoming(startEdgePoint, edge);
        for (const exitEdgePoint of this.summaryStore.getEndSummaries(startEdgePoint)) {
            if (!returnSite) continue;
            const returnFlowFunc = this.problem.getExitToReturnFlowFunction(exitEdgePoint.node, returnSite, callEdgePoint.node);
            for (const returnFact of returnFlowFunc.getDataFacts(exitEdgePoint.fact)) {
                this.summaryStore.addCallSummary(edge.edgeEnd, new PathEdgePoint<D>(returnSite, returnFact));
            }
        }
        for (const exceptionalExitPoint of this.summaryStore.getExceptionalEndSummaries(startEdgePoint)) {
            this.applyExceptionalSummaryToCaller(new Set([edge]), edge, exceptionalExitPoint);
        }
    }

    protected createCalleeStartPoint(firstStmt: Stmt, fact: D): PathEdgePoint<D> {
        return new PathEdgePoint(firstStmt, fact);
    }

    protected doSolve(): void {
        while (this.hasPendingEdge()) {
            const pathEdge = this.takeNextEdge()!;
            if (this.statistics) this.statistics.processedEdges++;
            const targetStmt = pathEdge.edgeEnd.node;
            if (!targetStmt) continue;
            if (this.icfg.isCallStatement(targetStmt)) {
                this.processCallNode(pathEdge);
            } else if (this.icfg.isExitStatement(targetStmt)) {
                this.processExitNode(pathEdge);
            } else {
                this.processNormalNode(pathEdge);
            }
        }
    }

    protected hasPendingEdge(): boolean {
        return this.immediateWorkListHead < this.immediateWorkList.length || this.deferredWorkList.length > 0;
    }

    protected takeNextEdge(): PathEdge<D> | undefined {
        if (this.immediateWorkListHead < this.immediateWorkList.length) {
            const edge = this.immediateWorkList[this.immediateWorkListHead++];
            if (this.immediateWorkListHead === this.immediateWorkList.length) {
                this.immediateWorkList = [];
                this.immediateWorkListHead = 0;
            }
            return edge;
        }
        return this.deferredWorkList.pop();
    }

    public getPathEdgeSet(): Set<PathEdge<D>> {
        return this.pathEdgeStore.asSet();
    }

    public getStatistics(): Readonly<IFDSSolverStatistics> | undefined {
        return this.statistics ? { ...this.statistics } : undefined;
    }
}
