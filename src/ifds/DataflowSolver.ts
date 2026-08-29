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
import { DataflowProblem, FlowFunction } from './DataflowProblem';
import { PathEdge, PathEdgePoint } from './Edge';
import {
    createSolverStatistics,
    DataflowSolverOptions,
    IFDSSolverStatistics,
} from './SolverStatistics';

/*
 * This program is roughly an implementation of the paper:
 * Practical Extensions to the IFDS Algorithm.
 */
type CallToReturnCacheEdge<D> = PathEdge<D>;

export abstract class DataflowSolver<D> {
    protected problem: DataflowProblem<D>;
    protected workList: Array<PathEdge<D>>;
    protected pathEdgeSet: Set<PathEdge<D>>;
    protected zeroFact: D;
    protected inComing: Map<PathEdgePoint<D>, Set<PathEdgePoint<D>>>;
    protected endSummary: Map<PathEdgePoint<D>, Set<PathEdgePoint<D>>>;
    protected summaryEdge: Set<CallToReturnCacheEdge<D>>;
    protected scene: Scene;
    protected CHA!: ClassHierarchyAnalysis;
    protected stmtNexts: Map<Stmt, Set<Stmt>>;
    protected laterEdges: Set<PathEdge<D>> = new Set();
    private readonly statistics?: IFDSSolverStatistics;
    private pendingDeferredEdges = 0;

    constructor(
        problem: DataflowProblem<D>,
        scene: Scene,
        options: DataflowSolverOptions = {}
    ) {
        this.problem = problem;
        this.scene = scene;
        this.zeroFact = problem.createZeroValue();
        this.workList = new Array<PathEdge<D>>();
        this.pathEdgeSet = new Set<PathEdge<D>>();
        this.inComing = new Map<PathEdgePoint<D>, Set<PathEdgePoint<D>>>();
        this.endSummary = new Map<PathEdgePoint<D>, Set<PathEdgePoint<D>>>();
        this.summaryEdge = new Set<CallToReturnCacheEdge<D>>();
        this.stmtNexts = new Map();
        if (options.collectStatistics) {
            this.statistics = createSolverStatistics('later-edge-worklist');
        }
    }

    public solve(): void {
        const startTime = Date.now();
        this.init();
        this.doSolve();
        if (this.statistics) {
            this.statistics.solveTimeMs = Date.now() - startTime;
            this.statistics.finalPathEdgeCount = this.pathEdgeSet.size;
            this.statistics.finalLaterEdgesSize = this.laterEdges.size;
        }
    }

    protected computeResult(stmt: Stmt, d: D): boolean {
        for (const pathEdge of this.pathEdgeSet) {
            if (pathEdge.edgeEnd.node === stmt && pathEdge.edgeEnd.fact === d) {
                return true;
            }
        }
        return false;
    }

    protected getChildren(stmt: Stmt): Stmt[] {
        return Array.from(this.stmtNexts.get(stmt) || []);
    }

    protected init(): void {
        const edgePoint = new PathEdgePoint<D>(this.problem.getEntryPoint(), this.zeroFact);
        const edge = new PathEdge<D>(edgePoint, edgePoint);
        this.workList.push(edge);
        this.pathEdgeSet.add(edge);
        if (this.statistics) {
            this.statistics.propagationAttempts++;
            this.statistics.uniqueEdgesEnqueued++;
            this.statistics.immediateEnqueued++;
            this.updateQueuePeaks();
        }

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

    protected pathEdgeSetHasEdge(edge: PathEdge<D>): boolean {
        for (const path of this.pathEdgeSet) {
            this.problem.factEqual(path.edgeEnd.fact, edge.edgeEnd.fact);
            if (
                path.edgeEnd.node === edge.edgeEnd.node &&
                this.problem.factEqual(path.edgeEnd.fact, edge.edgeEnd.fact) &&
                path.edgeStart.node === edge.edgeStart.node &&
                this.problem.factEqual(path.edgeStart.fact, edge.edgeStart.fact)
            ) {
                return true;
            }
        }
        return false;
    }

    private enqueueEdge(edge: PathEdge<D>, deferred: boolean): boolean {
        if (this.statistics) {
            this.statistics.propagationAttempts++;
            if (deferred) this.statistics.deferredPropagationAttempts++;
        }
        if (!this.pathEdgeSetHasEdge(edge)) {
            let index = this.workList.length;
            for (let i = 0; i < this.workList.length; i++) {
                if (this.laterEdges.has(this.workList[i])) {
                    index = i;
                    break;
                }
            }
            this.workList.splice(index, 0, edge);
            this.pathEdgeSet.add(edge);
            if (deferred) this.pendingDeferredEdges++;
            if (this.statistics) {
                this.statistics.uniqueEdgesEnqueued++;
                if (deferred) {
                    this.statistics.deferredEnqueued++;
                } else {
                    this.statistics.immediateEnqueued++;
                }
            }
            return true;
        }
        if (this.statistics) {
            this.statistics.duplicateEdgesSkipped++;
            if (deferred) this.statistics.deferredDuplicateEdgesSkipped++;
        }
        return false;
    }

    protected propagate(edge: PathEdge<D>): void {
        this.enqueueEdge(edge, false);
        this.updateQueuePeaks();
    }

    private updateQueuePeaks(): void {
        if (!this.statistics) return;
        const deferred = this.pendingDeferredEdges;
        const immediate = this.workList.length - deferred;
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
            this.workList.length
        );
        this.statistics.maxLaterEdgesSize = Math.max(
            this.statistics.maxLaterEdgesSize,
            this.laterEdges.size
        );
    }

    protected processExitNode(edge: PathEdge<D>): void {
        const startEdgePoint = edge.edgeStart;
        const exitEdgePoint = edge.edgeEnd;
        const summary = this.endSummary.get(startEdgePoint);
        if (summary === undefined) {
            this.endSummary.set(startEdgePoint, new Set([exitEdgePoint]));
        } else {
            summary.add(exitEdgePoint);
        }
        const callEdgePoints = this.inComing.get(startEdgePoint);
        if (callEdgePoints === undefined) {
            if (startEdgePoint.node.getCfg()!.getDeclaringMethod() ===
                this.problem.getEntryMethod()) {
                return;
            }
            throw new Error(
                'incoming does not have ' +
                startEdgePoint.node.getCfg()?.getDeclaringMethod().toString()
            );
        }
        for (const callEdgePoint of callEdgePoints) {
            const returnSite = this.getReturnSiteOfCall(callEdgePoint.node);
            if (!returnSite) continue;
            const returnFlowFunc = this.problem.getExitToReturnFlowFunction(
                exitEdgePoint.node,
                returnSite,
                callEdgePoint.node
            );
            this.handleFacts(returnFlowFunc, returnSite, exitEdgePoint, callEdgePoint);
        }
    }

    private handleFacts(
        returnFlowFunc: FlowFunction<D>,
        returnSite: Stmt,
        exitEdgePoint: PathEdgePoint<D>,
        callEdgePoint: PathEdgePoint<D>
    ): void {
        for (const fact of returnFlowFunc.getDataFacts(exitEdgePoint.fact)) {
            const returnSitePoint = new PathEdgePoint<D>(returnSite, fact);
            const cacheEdge = new PathEdge<D>(callEdgePoint, returnSitePoint);
            let summaryEdgeHasCacheEdge = false;
            for (const sEdge of this.summaryEdge) {
                if (sEdge.edgeStart === callEdgePoint &&
                    sEdge.edgeEnd.node === returnSite &&
                    sEdge.edgeEnd.fact === fact) {
                    summaryEdgeHasCacheEdge = true;
                    break;
                }
            }
            if (summaryEdgeHasCacheEdge) {
                continue;
            }
            this.summaryEdge.add(cacheEdge);
            const startOfCaller = this.getStartOfCallerMethod(callEdgePoint.node);
            for (const pathEdge of this.pathEdgeSet) {
                if (pathEdge.edgeStart.node === startOfCaller &&
                    pathEdge.edgeEnd === callEdgePoint) {
                    this.propagate(new PathEdge<D>(pathEdge.edgeStart, returnSitePoint));
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
                this.enqueueEdge(nextEdge, true);
                this.laterEdges.add(nextEdge);
                this.updateQueuePeaks();
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
        for (const cacheEdge of this.summaryEdge) {
            if (cacheEdge.edgeStart === edge.edgeEnd &&
                cacheEdge.edgeEnd.node === returnSite) {
                this.propagate(new PathEdge<D>(start, cacheEdge.edgeEnd));
            }
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
        let coming: Set<PathEdgePoint<D>> | undefined;
        for (const incoming of this.inComing.keys()) {
            if (incoming.fact === startEdgePoint.fact && incoming.node === startEdgePoint.node) {
                coming = this.inComing.get(incoming);
                break;
            }
        }
        if (coming === undefined) {
            this.inComing.set(startEdgePoint, new Set([callEdgePoint]));
        } else {
            coming.add(callEdgePoint);
        }
        let exitEdgePoints: Set<PathEdgePoint<D>> = new Set();
        for (const end of this.endSummary.keys()) {
            if (end.fact === fact && end.node === firstStmt) {
                exitEdgePoints = this.endSummary.get(end)!;
            }
        }
        for (const exitEdgePoint of exitEdgePoints) {
            const returnFlowFunc = this.problem.getExitToReturnFlowFunction(
                exitEdgePoint.node,
                returnSite,
                callEdgePoint.node
            );
            for (const returnFact of returnFlowFunc.getDataFacts(exitEdgePoint.fact)) {
                this.summaryEdge.add(
                    new PathEdge<D>(
                        edge.edgeEnd,
                        new PathEdgePoint<D>(returnSite, returnFact)
                    )
                );
            }
        }
    }

    protected doSolve(): void {
        while (this.workList.length !== 0) {
            const pathEdge = this.workList.shift()!;
            if (this.laterEdges.has(pathEdge)) {
                this.laterEdges.delete(pathEdge);
                this.pendingDeferredEdges--;
            }
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
        return this.pathEdgeSet;
    }

    public getStatistics(): Readonly<IFDSSolverStatistics> | undefined {
        return this.statistics;
    }
}
