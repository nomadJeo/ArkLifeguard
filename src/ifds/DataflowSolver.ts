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
    AbstractInvokeExpr,
    addCfg2Stmt,
    ArkAwaitExpr,
    ArkCaughtExceptionRef,
    ArkInstanceFieldRef,
    ArkInvokeStmt,
    ArkMethod,
    ArkReturnStmt,
    ArkReturnVoidStmt,
    BasicBlock,
    CallGraph,
    CallGraphBuilder,
    ClassHierarchyAnalysis,
    Scene,
    Stmt,
    ArkThrowStmt,
} from '../adapter/arkanalyzer';
import { getRecallMethodInParam } from './CallResolver';
import { DataflowProblem } from './DataflowProblem';
import { PathEdge, PathEdgePoint } from './PathEdge';
import { PathEdgeStore } from './PathEdgeStore';
import { SummaryStore } from './SummaryStore';
import { createSolverStatistics, DataflowSolverOptions, IFDSSolverStatistics } from './SolverStatistics';

interface StmtSuccessors {
    normal: Set<Stmt>;
    exceptional: Set<Stmt>;
}

/*
 * This program is roughly an implementation of the paper:
 * Practical Extensions to the IFDS Algorithm.
 */
export abstract class DataflowSolver<D> {
    protected problem: DataflowProblem<D>;
    protected zeroFact: D;
    protected scene: Scene;
    protected CHA!: ClassHierarchyAnalysis;
    protected stmtNexts: Map<Stmt, StmtSuccessors>;
    protected readonly pathEdgeStore: PathEdgeStore<D>;
    protected readonly summaryStore: SummaryStore<D>;
    private immediateWorkList: Array<PathEdge<D>>;
    private immediateWorkListHead = 0;
    private deferredWorkList: Array<PathEdge<D>>;
    private readonly statistics?: IFDSSolverStatistics;

    constructor(problem: DataflowProblem<D>, scene: Scene, options: DataflowSolverOptions = {}) {
        this.problem = problem;
        this.scene = scene;
        this.zeroFact = problem.createZeroValue();
        this.immediateWorkList = [];
        this.deferredWorkList = [];
        this.pathEdgeStore = new PathEdgeStore(problem);
        this.summaryStore = new SummaryStore(problem);
        this.stmtNexts = new Map();
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

    protected getNormalChildren(stmt: Stmt): Stmt[] {
        return Array.from(this.stmtNexts.get(stmt)?.normal ?? []);
    }
    protected getExceptionalChildren(stmt: Stmt): Stmt[] {
        return Array.from(this.stmtNexts.get(stmt)?.exceptional ?? []);
    }

    protected mayThrow(stmt: Stmt): boolean {
        return (
            stmt instanceof ArkThrowStmt ||
            stmt.getInvokeExpr() !== undefined ||
            stmt.getExprs().some(expr => expr instanceof ArkAwaitExpr) ||
            stmt.containsArrayRef() ||
            stmt.getFieldRef() instanceof ArkInstanceFieldRef
        );
    }

    protected init(): void {
        this.summaryStore.clear();
        const edgePoint = new PathEdgePoint<D>(this.problem.getEntryPoint(), this.zeroFact);
        const edge = new PathEdge<D>(edgePoint, edgePoint);
        this.propagate(edge);

        const cg = new CallGraph(this.scene);
        this.CHA = new ClassHierarchyAnalysis(this.scene, cg, new CallGraphBuilder(cg, this.scene));
        this.buildStmtMapInClass();
        this.setCfg4AllStmt();
    }

    protected buildStmtMapInClass(): void {
        // Scene.getMethods() may expose the Scene's backing array.  Mutating it
        // here makes every subsequent solver see another synthetic entry and is
        // especially costly for multi-root analyses.
        const methods = new Set([...this.scene.getMethods(), this.problem.getEntryMethod()]);
        for (const method of methods) {
            const cfg = method.getCfg();
            const blocks: BasicBlock[] = [];
            if (cfg) {
                blocks.push(...cfg.getBlocks());
            }
            for (const block of blocks) {
                this.buildStmtMapInBlock(block);
            }
            this.repairFinallyAndCopiedHandlerEdges(method, blocks);
        }
    }

    protected buildStmtMapInBlock(block: BasicBlock): void {
        const stmts = block.getStmts();

        const normalBlockSuccessors = new Set<Stmt>();
        for (const successor of block.getSuccessors()) {
            for (const head of this.getFirstStatements(successor)) {
                normalBlockSuccessors.add(head);
            }
        }

        const exceptionalBlockSuccessors = new Set<Stmt>();
        for (const successor of block.getExceptionalSuccessorBlocks() ?? []) {
            for (const head of this.getFirstStatements(successor)) {
                exceptionalBlockSuccessors.add(head);
            }
        }

        for (let stmtIndex = 0; stmtIndex < stmts.length; stmtIndex++) {
            const stmt = stmts[stmtIndex];
            if (!stmt) continue;

            const normal = new Set<Stmt>();
            const exceptional = new Set<Stmt>();
            if (stmt instanceof ArkThrowStmt) {
                // A throw never falls through to the following statement.
                for (const successor of exceptionalBlockSuccessors) {
                    exceptional.add(successor);
                }
            } else if (stmtIndex !== stmts.length - 1) {
                const nextStmt = stmts[stmtIndex + 1];
                if (nextStmt) normal.add(nextStmt);
            } else {
                for (const successor of normalBlockSuccessors) {
                    normal.add(successor);
                }
            }
            if (this.mayThrow(stmt)) {
                for (const successor of exceptionalBlockSuccessors) {
                    exceptional.add(successor);
                }
            }
            this.stmtNexts.set(stmt, { normal, exceptional });
        }
    }

    private getFirstStatements(block: BasicBlock, visited = new Set<BasicBlock>()): Set<Stmt> {
        if (visited.has(block)) return new Set();
        visited.add(block);
        const head = block.getHead();
        if (head) return new Set([head]);
        const result = new Set<Stmt>();
        for (const successor of block.getSuccessors()) {
            for (const stmt of this.getFirstStatements(successor, visited)) {
                result.add(stmt);
            }
        }
        return result;
    }

    /**
     * ArkAnalyzer 1.0.90 leaves two gaps around finally lowering:
     * a return in a protected block is not linked to the normal finally copy,
     * and a copied finally body can lose the outer handler of its source stmt.
     * Recover both relations by matching source-backed statements in the copies.
     */
    private repairFinallyAndCopiedHandlerEdges(method: ArkMethod, blocks: BasicBlock[]): void {
        const traps = method.getBody()?.getTraps() ?? [];
        if (traps.length === 0) return;

        const blocksByStmt = new Map<Stmt, BasicBlock>();
        const sourceCopies = new Map<string, Stmt[]>();
        for (const block of blocks) {
            for (const stmt of block.getStmts()) {
                blocksByStmt.set(stmt, block);
                const key = this.getSourceStatementKey(stmt);
                if (!key) continue;
                const copies = sourceCopies.get(key) ?? [];
                copies.push(stmt);
                sourceCopies.set(key, copies);
            }
        }

        // A statement copied into an exceptional finally body inherits any outer
        // handlers that are present on its source-backed counterpart.
        for (const copies of sourceCopies.values()) {
            const inherited = new Set<Stmt>();
            const sourceBacked = copies.filter(stmt => stmt.getOriginalText() !== undefined);
            const syntheticCopies = copies.filter(stmt => stmt.getOriginalText() === undefined);
            if (sourceBacked.length === 0 || syntheticCopies.length === 0) continue;
            for (const stmt of sourceBacked) {
                for (const target of this.getExceptionalChildren(stmt)) {
                    inherited.add(target);
                }
            }
            if (inherited.size === 0) continue;
            for (const stmt of syntheticCopies) {
                if (!this.mayThrow(stmt)) continue;
                const successors = this.stmtNexts.get(stmt);
                if (!successors) continue;
                for (const target of inherited) successors.exceptional.add(target);
            }
        }

        for (const trap of traps) {
            const catchBlocks = trap.getCatchBlocks();
            const exceptionalFinally = catchBlocks.find(block => {
                const stmts = block.getStmts();
                return (
                    stmts[0]?.getDef() !== null &&
                    stmts[0]?.getUses().some(value => value instanceof ArkCaughtExceptionRef) &&
                    stmts.at(-1) instanceof ArkThrowStmt &&
                    stmts.at(-1)?.getOriginalText() === undefined
                );
            });
            if (!exceptionalFinally) continue;

            const finallySourceStmt = exceptionalFinally
                .getStmts()
                .slice(1, -1)
                .find(stmt => this.getSourceStatementKey(stmt) !== null);
            const sourceKey = finallySourceStmt ? this.getSourceStatementKey(finallySourceStmt) : null;
            if (!sourceKey) continue;
            const normalFinallyStmt = (sourceCopies.get(sourceKey) ?? []).find(
                stmt => blocksByStmt.get(stmt) !== exceptionalFinally && stmt.getOriginalText() !== undefined
            );
            if (!normalFinallyStmt) continue;

            for (const tryBlock of trap.getTryBlocks()) {
                const tail = tryBlock.getTail();
                if (!(tail instanceof ArkReturnStmt) && !(tail instanceof ArkReturnVoidStmt)) {
                    continue;
                }
                const successors = this.stmtNexts.get(tail);
                if (!successors) continue;
                successors.normal.clear();
                successors.normal.add(normalFinallyStmt);
            }
        }
    }

    private getSourceStatementKey(stmt: Stmt): string | null {
        if (stmt.getUses().some(value => value instanceof ArkCaughtExceptionRef)) {
            return null;
        }
        return `${stmt.constructor.name}:${stmt.toString()}`;
    }

    protected setCfg4AllStmt(): void {
        for (const cls of this.scene.getClasses()) {
            for (const mtd of cls.getMethods(true)) {
                addCfg2Stmt(mtd);
            }
        }
    }

    protected getAllCalleeMethods(callNode: ArkInvokeStmt): Set<ArkMethod> {
        const caller = callNode.getCfg()?.getDeclaringMethod() ?? this.problem.getEntryMethod();
        const callerNode = this.CHA.getCallGraph().getCallGraphNodeByMethod(caller.getSignature());
        if (!callerNode) {
            return new Set();
        }
        const callSites = this.CHA.resolveCall(callerNode.getID(), callNode);
        const methods: Set<ArkMethod> = new Set();
        for (const callSite of callSites) {
            const signature = this.CHA.getCallGraph().getMethodByFuncID(callSite.calleeFuncID);
            const method = signature ? this.scene.getMethod(signature) : null;
            if (method) {
                methods.add(method);
            }
        }
        return methods;
    }

    protected getCallees(invokeStmt: ArkInvokeStmt): Set<ArkMethod> {
        const declaringFile = invokeStmt.getInvokeExpr().getMethodSignature().getDeclaringClassSignature().getDeclaringFileSignature();
        if (this.scene.getFile(declaringFile)) {
            return this.getAllCalleeMethods(invokeStmt);
        }
        const recalled = getRecallMethodInParam(invokeStmt);
        return recalled ? new Set([recalled]) : new Set();
    }

    protected getReturnSiteOfCall(call: Stmt): Stmt | null {
        const normalNexts = this.stmtNexts.get(call)?.normal;
        return normalNexts?.values().next().value ?? null;
    }

    protected getExceptionalReturnSitesOfCall(call: Stmt): Stmt[] {
        return this.getExceptionalChildren(call);
    }

    private getHandlerContinuation(handler: Stmt): Stmt {
        if (handler.getUses().some(value => value instanceof ArkCaughtExceptionRef)) {
            return this.getNormalChildren(handler)[0] ?? handler;
        }
        return handler;
    }

    protected getStartOfCallerMethod(call: Stmt): Stmt {
        const cfg = call.getCfg()!;
        const paraNum = cfg.getDeclaringMethod().getParameters().length;
        return cfg.getStartingBlock()!.getStmts()[paraNum];
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
            const returnSite = this.getReturnSiteOfCall(callEdgePoint.node);
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
        const handlers = this.getExceptionalReturnSitesOfCall(callEdgePoint.node);
        if (handlers.length === 0) {
            // No handler in this method: retain the original throw site and payload
            // while moving the exceptional completion one stack frame outwards.
            this.processExceptionalExit(callerEdge.edgeStart, exceptionalExitPoint);
            return;
        }

        for (const handler of handlers) {
            const handlerTarget = this.getHandlerContinuation(handler);
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
        const startOfCaller = this.getStartOfCallerMethod(callEdgePoint.node);
        for (const callerEdge of callerEdges) {
            if (callerEdge.edgeEnd.node !== callEdgePoint.node || !this.problem.factEqual(callerEdge.edgeEnd.fact, callEdgePoint.fact)) continue;
            if (callerEdge.edgeStart.node !== startOfCaller) continue;
            this.propagate(new PathEdge<D>(callerEdge.edgeStart, returnSitePoint));
        }
    }

    protected processNormalNode(edge: PathEdge<D>): void {
        const start = edge.edgeStart;
        const end = edge.edgeEnd;

        const normalChildren = end.node instanceof ArkThrowStmt ? [] : this.getNormalChildren(end.node);
        for (const stmt of [...normalChildren].reverse()) {
            const flowFunction = this.problem.getNormalFlowFunction(end.node, stmt);
            const set = flowFunction.getDataFacts(end.fact);
            for (const fact of set) {
                const edgePoint = new PathEdgePoint<D>(stmt, fact);
                const nextEdge = new PathEdge<D>(start, edgePoint);
                this.propagate(nextEdge, true);
            }
        }

        for (const handler of [...this.getExceptionalChildren(end.node)].reverse()) {
            const handlerTarget = this.getHandlerContinuation(handler);
            const flowFunction = this.problem.getExceptionalFlowFunction(end.node, handler);
            for (const fact of flowFunction.getDataFacts(end.fact)) {
                this.propagate(new PathEdge(start, new PathEdgePoint(handlerTarget, fact)), true);
            }
        }

        if (this.mayThrow(end.node) && this.getExceptionalChildren(end.node).length === 0) {
            this.processExceptionalExit(start, end);
        }
    }

    protected processCallNode(edge: PathEdge<D>): void {
        const start = edge.edgeStart;
        const callEdgePoint = edge.edgeEnd;
        const returnSite = this.getReturnSiteOfCall(callEdgePoint.node);
        const handlers = this.getExceptionalReturnSitesOfCall(callEdgePoint.node);
        if (!returnSite && handlers.length === 0) return;
        const invokeStmt = callEdgePoint.node as ArkInvokeStmt;
        const callees = this.getCallees(invokeStmt);
        for (const callee of callees) {
            const callFlowFunc = this.problem.getCallFlowFunction(invokeStmt, callee);
            if (!callee.getCfg()) {
                continue;
            }
            const firstStmt = callee.getCfg()!.getStartingBlock()!.getStmts()[callee.getParameters().length];
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
            const handlerTarget = this.getHandlerContinuation(handler);
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
            if (this.isCallStatement(targetStmt)) {
                this.processCallNode(pathEdge);
            } else if (this.isExitStatement(targetStmt)) {
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

    protected isCallStatement(stmt: Stmt): boolean {
        if (!stmt) return false;
        for (const expr of stmt.getExprs()) {
            if (expr instanceof AbstractInvokeExpr) {
                const declaringFile = expr.getMethodSignature().getDeclaringClassSignature().getDeclaringFileSignature();
                if (this.scene.getFile(declaringFile)) {
                    return true;
                }
                if (stmt instanceof ArkInvokeStmt && getRecallMethodInParam(stmt)) {
                    return true;
                }
            }
        }
        return false;
    }

    protected isExitStatement(stmt: Stmt): boolean {
        if (stmt instanceof ArkThrowStmt) {
            return this.getExceptionalChildren(stmt).length === 0;
        }
        if (stmt instanceof ArkReturnStmt || stmt instanceof ArkReturnVoidStmt) {
            return this.getNormalChildren(stmt).length === 0;
        }
        return false;
    }

    public getPathEdgeSet(): Set<PathEdge<D>> {
        return this.pathEdgeStore.asSet();
    }

    public getStatistics(): Readonly<IFDSSolverStatistics> | undefined {
        return this.statistics ? { ...this.statistics } : undefined;
    }
}
