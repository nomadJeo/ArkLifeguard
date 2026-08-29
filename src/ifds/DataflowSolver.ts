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
} from '../adapter/arkanalyzer';
import { getRecallMethodInParam } from './CallResolver';
import { DataflowProblem } from './DataflowProblem';
import { PathEdge, PathEdgePoint } from './Edge';
import { PathEdgeStore } from './PathEdgeStore';
import { SummaryStore } from './SummaryStore';
import {
    createSolverStatistics,
    DataflowSolverOptions,
    IFDSSolverStatistics,
} from './SolverStatistics';

/*
 * This program is roughly an implementation of the paper:
 * Practical Extensions to the IFDS Algorithm.
 */
export abstract class DataflowSolver<D> {
    protected problem: DataflowProblem<D>;
    protected zeroFact: D;
    protected scene: Scene;
    protected CHA!: ClassHierarchyAnalysis;
    protected stmtNexts: Map<Stmt, Set<Stmt>>;
    protected readonly pathEdgeStore: PathEdgeStore<D>;
    protected readonly summaryStore: SummaryStore<D>;
    private immediateWorkList: Array<PathEdge<D>>;
    private immediateWorkListHead = 0;
    private deferredWorkList: Array<PathEdge<D>>;
    private readonly statistics?: IFDSSolverStatistics;

    constructor(
        problem: DataflowProblem<D>,
        scene: Scene,
        options: DataflowSolverOptions = {}
    ) {
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

    protected getChildren(stmt: Stmt): Stmt[] {
        return Array.from(this.stmtNexts.get(stmt) || []);
    }

    protected init(): void {
        this.summaryStore.clear();
        const edgePoint = new PathEdgePoint<D>(this.problem.getEntryPoint(), this.zeroFact);
        const edge = new PathEdge<D>(edgePoint, edgePoint);
        this.propagate(edge);

        const cg = new CallGraph(this.scene);
        this.CHA = new ClassHierarchyAnalysis(
            this.scene,
            cg,
            new CallGraphBuilder(cg, this.scene)
        );
        this.buildStmtMapInClass();
        this.setCfg4AllStmt();
    }

    protected buildStmtMapInClass(): void {
        // Scene.getMethods() may expose the Scene's backing array.  Mutating it
        // here makes every subsequent solver see another synthetic entry and is
        // especially costly for multi-root analyses.
        const methods = new Set([
            ...this.scene.getMethods(),
            this.problem.getEntryMethod(),
        ]);
        for (const method of methods) {
            const cfg = method.getCfg();
            const blocks: BasicBlock[] = [];
            if (cfg) {
                blocks.push(...cfg.getBlocks());
            }
            for (const block of blocks) {
                this.buildStmtMapInBlock(block);
            }
        }
    }

    protected buildStmtMapInBlock(block: BasicBlock): void {
        const stmts = block.getStmts();
        for (let stmtIndex = 0; stmtIndex < stmts.length; stmtIndex++) {
            const stmt = stmts[stmtIndex];
            if (!stmt) continue;
            if (stmtIndex !== stmts.length - 1) {
                const nextStmt = stmts[stmtIndex + 1];
                if (nextStmt) this.stmtNexts.set(stmt, new Set([nextStmt]));
            } else {
                const set: Set<Stmt> = new Set();
                for (const successor of block.getSuccessors()) {
                    const head = successor.getHead();
                    if (head) set.add(head);
                }
                if (set.size > 0) this.stmtNexts.set(stmt, set);
            }
        }
    }

    protected setCfg4AllStmt(): void {
        for (const cls of this.scene.getClasses()) {
            for (const mtd of cls.getMethods(true)) {
                addCfg2Stmt(mtd);
            }
        }
    }

    protected getAllCalleeMethods(callNode: ArkInvokeStmt): Set<ArkMethod> {
        const caller = callNode.getCfg()?.getDeclaringMethod() ??
            this.problem.getEntryMethod();
        const callerNode = this.CHA.getCallGraph()
            .getCallGraphNodeByMethod(caller.getSignature());
        if (!callerNode) {
            return new Set();
        }
        const callSites = this.CHA.resolveCall(
            callerNode.getID(),
            callNode
        );
        const methods: Set<ArkMethod> = new Set();
        for (const callSite of callSites) {
            const signature = this.CHA.getCallGraph()
                .getMethodByFuncID(callSite.calleeFuncID);
            const method = signature ? this.scene.getMethod(signature) : null;
            if (method) {
                methods.add(method);
            }
        }
        return methods;
    }

    protected getReturnSiteOfCall(call: Stmt): Stmt | null {
        const nexts = this.stmtNexts.get(call);
        const arr = nexts ? [...nexts] : [];
        return arr[0] ?? null;
    }

    protected getStartOfCallerMethod(call: Stmt): Stmt {
        const cfg = call.getCfg()!;
        const paraNum = cfg.getDeclaringMethod().getParameters().length;
        return cfg.getStartingBlock()!.getStmts()[paraNum];
    }

    private recordDeduplicationLookup(
        candidateChecks: number,
        factEqualityChecks: number
    ): void {
        if (!this.statistics) return;
        this.statistics.deduplicationLookups++;
        this.statistics.deduplicationCandidateChecks += candidateChecks;
        this.statistics.factEqualityChecks += factEqualityChecks;
        this.statistics.maxDeduplicationCandidates = Math.max(
            this.statistics.maxDeduplicationCandidates,
            candidateChecks
        );
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
        this.recordDeduplicationLookup(
            insertion.candidateChecks,
            insertion.factEqualityChecks
        );
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
        this.statistics.maxImmediateQueueSize = Math.max(
            this.statistics.maxImmediateQueueSize,
            immediate
        );
        this.statistics.maxDeferredQueueSize = Math.max(
            this.statistics.maxDeferredQueueSize,
            deferred
        );
        this.statistics.maxCombinedQueueSize = Math.max(
            this.statistics.maxCombinedQueueSize,
            immediate + deferred
        );
    }

    protected processExitNode(edge: PathEdge<D>): void {
        const startEdgePoint = edge.edgeStart;
        const exitEdgePoint = edge.edgeEnd;
        this.summaryStore.addEndSummary(startEdgePoint, exitEdgePoint);
        const callerEdges = this.summaryStore.getIncoming(startEdgePoint);
        if (callerEdges === undefined) {
            if (startEdgePoint.node.getCfg()!.getDeclaringMethod() ===
                this.problem.getEntryMethod()) {
                return;
            }
            throw new Error(
                'incoming does not have ' +
                startEdgePoint.node.getCfg()?.getDeclaringMethod().toString()
            );
        }
        for (const callerEdge of callerEdges) {
            const callEdgePoint = callerEdge.edgeEnd;
            const returnSite = this.getReturnSiteOfCall(callEdgePoint.node);
            if (!returnSite) continue;
            const returnFlowFunc = this.problem.getExitToReturnFlowFunction(
                exitEdgePoint.node,
                returnSite,
                callEdgePoint.node
            );
            for (const fact of returnFlowFunc.getDataFacts(exitEdgePoint.fact)) {
                const returnSitePoint = new PathEdgePoint<D>(returnSite, fact);
                if (!this.summaryStore.addCallSummary(
                    callEdgePoint,
                    returnSitePoint
                )) continue;
                const startOfCaller = this.getStartOfCallerMethod(callEdgePoint.node);
                if (callerEdge.edgeStart.node === startOfCaller) {
                    this.propagate(new PathEdge<D>(
                        callerEdge.edgeStart,
                        returnSitePoint
                    ));
                }
            }
        }
    }

    protected processNormalNode(edge: PathEdge<D>): void {
        const start = edge.edgeStart;
        const end = edge.edgeEnd;
        const stmts = [...this.getChildren(end.node)].reverse();
        for (const stmt of stmts) {
            const flowFunction = this.problem.getNormalFlowFunction(end.node, stmt);
            const set = flowFunction.getDataFacts(end.fact);
            for (const fact of set) {
                const edgePoint = new PathEdgePoint<D>(stmt, fact);
                const nextEdge = new PathEdge<D>(start, edgePoint);
                this.propagate(nextEdge, true);
            }
        }
    }

    protected processCallNode(edge: PathEdge<D>): void {
        const start = edge.edgeStart;
        const callEdgePoint = edge.edgeEnd;
        const returnSite = this.getReturnSiteOfCall(callEdgePoint.node);
        if (!returnSite) return;
        const invokeStmt = callEdgePoint.node as ArkInvokeStmt;
        let callees: Set<ArkMethod>;
        const declaringFile = invokeStmt.getInvokeExpr().getMethodSignature()
            .getDeclaringClassSignature().getDeclaringFileSignature();
        if (this.scene.getFile(declaringFile)) {
            callees = this.getAllCalleeMethods(invokeStmt);
        } else {
            callees = new Set([getRecallMethodInParam(invokeStmt)!]);
        }
        for (const callee of callees) {
            const callFlowFunc = this.problem.getCallFlowFunction(invokeStmt, callee);
            if (!callee.getCfg()) {
                continue;
            }
            const firstStmt = callee.getCfg()!.getStartingBlock()!
                .getStmts()[callee.getParameters().length];
            const facts = callFlowFunc.getDataFacts(callEdgePoint.fact);
            for (const fact of facts) {
                this.callNodeFactPropagate(edge, firstStmt, fact, returnSite);
            }
        }
        const callToReturnflowFunc = this.problem.getCallToReturnFlowFunction(
            edge.edgeEnd.node,
            returnSite,
            callees
        );
        const set = callToReturnflowFunc.getDataFacts(callEdgePoint.fact);
        for (const fact of set) {
            this.propagate(new PathEdge<D>(start, new PathEdgePoint<D>(returnSite, fact)));
        }
        for (const summaryPoint of this.summaryStore.getCallSummaries(
            callEdgePoint,
            returnSite
        )) {
            this.propagate(new PathEdge<D>(start, summaryPoint));
        }
    }

    protected callNodeFactPropagate(
        edge: PathEdge<D>,
        firstStmt: Stmt,
        fact: D,
        returnSite: Stmt
    ): void {
        const callEdgePoint = edge.edgeEnd;
        const startEdgePoint = new PathEdgePoint(firstStmt, fact);
        this.propagate(new PathEdge<D>(startEdgePoint, startEdgePoint));
        this.summaryStore.addIncoming(startEdgePoint, edge);
        for (const exitEdgePoint of this.summaryStore.getEndSummaries(startEdgePoint)) {
            const returnFlowFunc = this.problem.getExitToReturnFlowFunction(
                exitEdgePoint.node,
                returnSite,
                callEdgePoint.node
            );
            for (const returnFact of returnFlowFunc.getDataFacts(exitEdgePoint.fact)) {
                this.summaryStore.addCallSummary(
                    edge.edgeEnd,
                    new PathEdgePoint<D>(returnSite, returnFact)
                );
            }
        }
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
        return this.immediateWorkListHead < this.immediateWorkList.length ||
            this.deferredWorkList.length > 0;
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
                const declaringFile = expr.getMethodSignature()
                    .getDeclaringClassSignature().getDeclaringFileSignature();
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
        return stmt instanceof ArkReturnStmt || stmt instanceof ArkReturnVoidStmt;
    }

    public getPathEdgeSet(): Set<PathEdge<D>> {
        return this.pathEdgeStore.asSet();
    }

    public getStatistics(): Readonly<IFDSSolverStatistics> | undefined {
        return this.statistics ? { ...this.statistics } : undefined;
    }
}
