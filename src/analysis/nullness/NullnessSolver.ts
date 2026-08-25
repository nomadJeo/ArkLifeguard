/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
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

import type { Scene } from '../../adapter/arkanalyzer';
import { ArkAssignStmt, ArkInvokeStmt, Stmt } from '../../adapter/arkanalyzer';
import { PathEdge, PathEdgePoint } from '../../ifds';
import { ArkMethod } from '../../adapter/arkanalyzer';
import { FunctionType } from '../../adapter/arkanalyzer';
import { getRecallMethodInParam } from '../../ifds';
// Import through ArkAnalyzer's public barrel. Directly loading DataflowSolver before
// Scene is initialized exposes the existing ArkFile -> src/index circular dependency.
import { DataflowSolver } from '../../ifds';
import { NullnessFact } from './NullnessFact';
import { NullnessProblem } from './NullnessProblem';
import { resolveProjectMethods } from './ProjectMethodResolver';

interface PointIndexEntry<T> {
    point: PathEdgePoint<NullnessFact>;
    value: T;
}

interface SummaryCacheEntry {
    point: PathEdgePoint<NullnessFact>;
    byReturnSite: Map<Stmt, PathEdgePoint<NullnessFact>[]>;
}

export interface NullnessSolverRoot {
    entryPoint: Stmt;
    entryMethod: ArkMethod;
}

/** Thin typed facade over ArkAnalyzer's generic IFDS solver. */
export class NullnessSolver extends DataflowSolver<NullnessFact> {
    /**
     * ArkAnalyzer's generic solver checks every previously reached path edge when
     * deduplicating a new edge. Nullness analyses routinely create tens of
     * thousands of semantically equal fact objects, so that scan becomes
     * quadratic. Keep a nullness-specific hash index and retain an equality check
     * inside each bucket to make hash collisions harmless.
     */
    private readonly pathEdgeIndex = new Map<string, PathEdge<NullnessFact>[]>();
    private readonly statementIds = new WeakMap<Stmt, number>();
    private nextStatementId = 1;
    private immediateWorkList: PathEdge<NullnessFact>[] = [];
    private immediateWorkListHead = 0;
    private deferredWorkList: PathEdge<NullnessFact>[] = [];
    private readonly incomingIndex = new Map<
        string,
        PointIndexEntry<Set<PathEdge<NullnessFact>>>[]
    >();
    private readonly endSummaryIndex = new Map<
        string,
        PointIndexEntry<Set<PathEdgePoint<NullnessFact>>>[]
    >();
    /** Summaries are keyed by semantic call point, not PathEdgePoint identity. */
    private readonly summaryCache = new Map<string, SummaryCacheEntry[]>();
    /** Callee resolution depends on the invoke statement, never on the input fact. */
    private readonly calleeCache = new Map<ArkInvokeStmt, Set<ArkMethod>>();
    private readonly recursiveMethods: Set<ArkMethod>;
    private readonly largeProjectWidening: boolean;

    private readonly rootMethods: Set<ArkMethod>;

    constructor(
        problem: NullnessProblem,
        scene: Scene,
        private readonly additionalRoots: readonly NullnessSolverRoot[] = []
    ) {
        super(problem, scene);
        this.recursiveMethods = this.findRecursiveMethods(scene);
        this.largeProjectWidening = scene.getMethods().length >=
            problem.getConfig().largeProjectWideningThreshold;
        this.rootMethods = new Set([
            problem.getEntryMethod(),
            ...additionalRoots.map(root => root.entryMethod),
        ]);
    }

    protected init(): void {
        super.init();
        for (const root of this.additionalRoots) {
            const rootPoint = new PathEdgePoint(root.entryPoint, this.zeroFact);
            const rootEdge = new PathEdge(rootPoint, rootPoint);
            this.workList.push(rootEdge);
            this.pathEdgeSet.add(rootEdge);
        }
        this.pathEdgeIndex.clear();
        this.incomingIndex.clear();
        this.endSummaryIndex.clear();
        this.summaryCache.clear();
        this.calleeCache.clear();
        for (const edge of this.pathEdgeSet) {
            this.addEdgeToIndex(edge);
        }
        // The generic solver stores both priority classes in one Array and uses
        // shift(), a linear scan and splice() for every insertion/removal. Keep
        // its initial edge, then use two O(1) queues while preserving the same
        // ordering: call/return edges are FIFO and normal-flow edges are LIFO.
        this.immediateWorkList = [...this.workList];
        this.immediateWorkListHead = 0;
        this.deferredWorkList = [];
        this.workList.length = 0;
    }

    protected pathEdgeSetHasEdge(edge: PathEdge<NullnessFact>): boolean {
        const key = this.edgeHashKey(edge);
        const bucket = this.pathEdgeIndex.get(key);
        if (bucket?.some(existing => this.edgesEqual(existing, edge))) {
            return true;
        }

        // DataflowSolver adds the edge to pathEdgeSet immediately after a false
        // result, so index it here without performing a second lookup.
        if (bucket) {
            bucket.push(edge);
        } else {
            this.pathEdgeIndex.set(key, [edge]);
        }
        return false;
    }

    protected propagate(edge: PathEdge<NullnessFact>): void {
        this.enqueueIfNew(edge, false);
    }

    protected processNormalNode(edge: PathEdge<NullnessFact>): void {
        const start = edge.edgeStart;
        const end = edge.edgeEnd;
        const stmts = [...this.getChildren(end.node)].reverse();
        for (const stmt of stmts) {
            const flowFunction = this.problem.getNormalFlowFunction(end.node, stmt);
            for (const fact of flowFunction.getDataFacts(end.fact)) {
                this.enqueueIfNew(
                    new PathEdge(
                        start,
                        new PathEdgePoint<NullnessFact>(stmt, fact)
                    ),
                    true
                );
            }
        }
    }

    protected doSolve(): void {
        while (this.hasPendingEdge()) {
            const pathEdge = this.takeNextEdge();
            const targetStmt = pathEdge.edgeEnd.node;
            if (!targetStmt) continue;
            const isCall = this.isCallStatement(targetStmt);
            if (isCall) {
                this.processCallNode(pathEdge);
            } else if (this.isExitStatement(targetStmt)) {
                this.processExitNode(pathEdge);
            } else {
                this.processNormalNode(pathEdge);
            }
        }
    }

    protected processExitNode(edge: PathEdge<NullnessFact>): void {
        const startEdgePoint = edge.edgeStart;
        const exitEdgePoint = edge.edgeEnd;
        this.getOrCreatePointValue(
            this.endSummaryIndex,
            startEdgePoint,
            () => new Set<PathEdgePoint<NullnessFact>>()
        ).add(exitEdgePoint);

        const callerEdges = this.findPointValue(this.incomingIndex, startEdgePoint);
        if (!callerEdges) {
            if (this.rootMethods.has(
                startEdgePoint.node.getCfg()!.getDeclaringMethod()
            )) {
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
            const returnFlow = this.problem.getExitToReturnFlowFunction(
                exitEdgePoint.node,
                returnSite,
                callEdgePoint.node
            );
            for (const fact of returnFlow.getDataFacts(exitEdgePoint.fact)) {
                const returnSitePoint = new PathEdgePoint(returnSite, fact);
                if (!this.addSummaryPoint(callEdgePoint, returnSitePoint)) {
                    continue;
                }
                const startOfCaller = this.getStartOfCallerMethod(callEdgePoint.node);
                if (callerEdge.edgeStart.node === startOfCaller) {
                    this.propagate(new PathEdge(callerEdge.edgeStart, returnSitePoint));
                }
            }
        }
    }

    protected processCallNode(edge: PathEdge<NullnessFact>): void {
        const start = edge.edgeStart;
        const callEdgePoint = edge.edgeEnd;
        const returnSite = this.getReturnSiteOfCall(callEdgePoint.node);
        if (!returnSite) return;
        const invokeStmt = callEdgePoint.node as ArkInvokeStmt;
        const callees = this.getCallees(invokeStmt);

        for (const callee of callees) {
            const cfg = callee.getCfg();
            if (!cfg) continue;
            const firstStmt = cfg.getStartingBlock()!.getStmts()[callee.getParameters().length];
            const callFlow = this.problem.getCallFlowFunction(invokeStmt, callee);
            for (const fact of callFlow.getDataFacts(callEdgePoint.fact)) {
                this.callNodeFactPropagate(edge, firstStmt, fact, returnSite);
            }
        }

        const callToReturnFlow = this.problem.getCallToReturnFlowFunction(
            callEdgePoint.node,
            returnSite,
            callees
        );
        for (const fact of callToReturnFlow.getDataFacts(callEdgePoint.fact)) {
            this.propagate(new PathEdge(start, new PathEdgePoint(returnSite, fact)));
        }
        for (const summaryPoint of this.getSummaryPoints(callEdgePoint, returnSite)) {
            this.propagate(new PathEdge(start, summaryPoint));
        }
    }

    protected callNodeFactPropagate(
        edge: PathEdge<NullnessFact>,
        firstStmt: Stmt,
        fact: NullnessFact,
        returnSite: Stmt
    ): void {
        const callEdgePoint = edge.edgeEnd;
        const rawStartPoint = new PathEdgePoint(firstStmt, fact);
        const startEdgePoint = new PathEdgePoint(
            firstStmt,
            this.abstractPointFact(rawStartPoint, true)
        );
        this.propagate(new PathEdge(startEdgePoint, startEdgePoint));
        this.getOrCreatePointValue(
            this.incomingIndex,
            startEdgePoint,
            () => new Set<PathEdge<NullnessFact>>()
        ).add(edge);

        const exitEdgePoints = this.findPointValue(this.endSummaryIndex, startEdgePoint);
        for (const exitEdgePoint of exitEdgePoints ?? []) {
            const returnFlow = this.problem.getExitToReturnFlowFunction(
                exitEdgePoint.node,
                returnSite,
                callEdgePoint.node
            );
            for (const returnFact of returnFlow.getDataFacts(exitEdgePoint.fact)) {
                this.addSummaryPoint(
                    callEdgePoint,
                    new PathEdgePoint(returnSite, returnFact)
                );
            }
        }
    }

    getReachedFacts(): Map<Stmt, NullnessFact[]> {
        const reached = new Map<Stmt, NullnessFact[]>();
        const reachedIndex = new Map<Stmt, Map<number, NullnessFact[]>>();
        for (const edge of this.pathEdgeSet) {
            const stmt = edge.edgeEnd.node;
            const fact = edge.edgeEnd.fact;
            const facts = reached.get(stmt) ?? [];
            let factBuckets = reachedIndex.get(stmt);
            if (!factBuckets) {
                factBuckets = new Map<number, NullnessFact[]>();
                reachedIndex.set(stmt, factBuckets);
            }
            const hash = fact.hashCode();
            const bucket = factBuckets.get(hash);
            if (!bucket?.some(existing => this.problem.factEqual(existing, fact))) {
                facts.push(fact);
                reached.set(stmt, facts);
                if (bucket) {
                    bucket.push(fact);
                } else {
                    factBuckets.set(hash, [fact]);
                }
            }
        }
        return reached;
    }

    private addEdgeToIndex(edge: PathEdge<NullnessFact>): void {
        const key = this.edgeHashKey(edge);
        const bucket = this.pathEdgeIndex.get(key);
        if (bucket) {
            bucket.push(edge);
        } else {
            this.pathEdgeIndex.set(key, [edge]);
        }
    }

    private enqueueIfNew(edge: PathEdge<NullnessFact>, deferred: boolean): void {
        edge = this.abstractEdgeFacts(edge);
        if (!edge.edgeEnd.fact.isZeroFact() &&
            edge.edgeEnd.fact.propagationDepth >
                (this.problem as NullnessProblem).getConfig().maxPropagationDepth) {
            return;
        }
        if (this.pathEdgeSetHasEdge(edge)) {
            return;
        }
        this.pathEdgeSet.add(edge);
        if (deferred) {
            this.deferredWorkList.push(edge);
        } else {
            this.immediateWorkList.push(edge);
        }
    }

    private abstractEdgeFacts(
        edge: PathEdge<NullnessFact>
    ): PathEdge<NullnessFact> {
        const startFact = this.abstractPointFact(edge.edgeStart, true);
        const endFact = this.abstractPointFact(edge.edgeEnd);
        if (startFact === edge.edgeStart.fact && endFact === edge.edgeEnd.fact) {
            return edge;
        }
        return new PathEdge(
            new PathEdgePoint(edge.edgeStart.node, startFact),
            new PathEdgePoint(edge.edgeEnd.node, endFact)
        );
    }

    private abstractPointFact(
        point: PathEdgePoint<NullnessFact>,
        methodEntry: boolean = false
    ): NullnessFact {
        const config = (this.problem as NullnessProblem).getConfig();
        const method = point.node.getCfg()?.getDeclaringMethod();
        const recursive = config.recursiveSccWidening &&
            method !== undefined && this.recursiveMethods.has(method);
        let maxLength = recursive
            ? Math.min(
                config.maxAccessPathLength,
                config.recursiveSccAccessPathLength
            )
            : config.maxAccessPathLength;
        if (this.largeProjectWidening) {
            maxLength = Math.min(
                maxLength,
                config.largeProjectAccessPathLength
            );
        }
        const bounded = point.fact.abstractAccessPath(maxLength);
        return recursive || (this.largeProjectWidening && methodEntry)
            ? bounded.widenKindForRecursion()
            : bounded;
    }

    /**
     * Build a project-method graph and identify recursive SCCs once. Facts inside
     * those SCCs are widened to a finite, caller-independent summary domain.
     */
    private findRecursiveMethods(scene: Scene): Set<ArkMethod> {
        const graph = new Map<ArkMethod, Set<ArkMethod>>();
        for (const method of scene.getMethods()) {
            const cfg = method.getCfg();
            if (!cfg) continue;
            const targets = new Set<ArkMethod>();
            for (const block of cfg.getBlocks()) {
                for (const stmt of block.getStmts()) {
                    const invoke = stmt.getInvokeExpr();
                    if (!invoke) continue;
                    const direct = scene.getMethod(invoke.getMethodSignature());
                    if (direct?.getCfg()) targets.add(direct);
                    if (!direct) {
                        for (const resolved of resolveProjectMethods(scene, stmt)) {
                            if (resolved.getCfg()) targets.add(resolved);
                        }
                    }
                }
            }
            graph.set(method, targets);
        }

        const recursive = new Set<ArkMethod>();
        const indices = new Map<ArkMethod, number>();
        const lowLinks = new Map<ArkMethod, number>();
        const stack: ArkMethod[] = [];
        const onStack = new Set<ArkMethod>();
        let nextIndex = 0;

        const visit = (method: ArkMethod): void => {
            const index = nextIndex++;
            indices.set(method, index);
            lowLinks.set(method, index);
            stack.push(method);
            onStack.add(method);
            for (const target of graph.get(method) ?? []) {
                if (!graph.has(target)) continue;
                if (!indices.has(target)) {
                    visit(target);
                    lowLinks.set(
                        method,
                        Math.min(lowLinks.get(method)!, lowLinks.get(target)!)
                    );
                } else if (onStack.has(target)) {
                    lowLinks.set(
                        method,
                        Math.min(lowLinks.get(method)!, indices.get(target)!)
                    );
                }
            }
            if (lowLinks.get(method) !== indices.get(method)) return;
            const component: ArkMethod[] = [];
            let member: ArkMethod;
            do {
                member = stack.pop()!;
                onStack.delete(member);
                component.push(member);
            } while (member !== method);
            if (component.length > 1 || graph.get(method)?.has(method)) {
                for (const recursiveMethod of component) recursive.add(recursiveMethod);
            }
        };

        for (const method of graph.keys()) {
            if (!indices.has(method)) visit(method);
        }
        return recursive;
    }

    private hasPendingEdge(): boolean {
        return this.immediateWorkListHead < this.immediateWorkList.length ||
            this.deferredWorkList.length > 0;
    }

    private takeNextEdge(): PathEdge<NullnessFact> {
        if (this.immediateWorkListHead < this.immediateWorkList.length) {
            return this.immediateWorkList[this.immediateWorkListHead++];
        }
        return this.deferredWorkList.pop()!;
    }

    private pointHashKey(point: PathEdgePoint<NullnessFact>): string {
        return `${this.statementId(point.node)}:${point.fact.hashCode()}`;
    }

    private findPointValue<T>(
        index: Map<string, PointIndexEntry<T>[]>,
        point: PathEdgePoint<NullnessFact>
    ): T | undefined {
        const bucket = index.get(this.pointHashKey(point));
        return bucket?.find(entry => this.pointsEqual(entry.point, point))?.value;
    }

    private getOrCreatePointValue<T>(
        index: Map<string, PointIndexEntry<T>[]>,
        point: PathEdgePoint<NullnessFact>,
        create: () => T
    ): T {
        const key = this.pointHashKey(point);
        const bucket = index.get(key);
        const existing = bucket?.find(entry => this.pointsEqual(entry.point, point));
        if (existing) return existing.value;
        const value = create();
        const entry = { point, value };
        if (bucket) {
            bucket.push(entry);
        } else {
            index.set(key, [entry]);
        }
        return value;
    }

    private addSummaryPoint(
        callEdgePoint: PathEdgePoint<NullnessFact>,
        summaryPoint: PathEdgePoint<NullnessFact>
    ): boolean {
        const key = this.pointHashKey(callEdgePoint);
        let bucket = this.summaryCache.get(key);
        let entry = bucket?.find(candidate => this.pointsEqual(candidate.point, callEdgePoint));
        if (!entry) {
            entry = { point: callEdgePoint, byReturnSite: new Map() };
            if (bucket) {
                bucket.push(entry);
            } else {
                this.summaryCache.set(key, [entry]);
            }
        }
        const summaries = entry.byReturnSite.get(summaryPoint.node) ?? [];
        if (summaries.some(existing =>
            this.problem.factEqual(existing.fact, summaryPoint.fact))) {
            return false;
        }
        summaries.push(summaryPoint);
        entry.byReturnSite.set(summaryPoint.node, summaries);
        return true;
    }

    private getSummaryPoints(
        callEdgePoint: PathEdgePoint<NullnessFact>,
        returnSite: Stmt
    ): readonly PathEdgePoint<NullnessFact>[] {
        const bucket = this.summaryCache.get(this.pointHashKey(callEdgePoint));
        const entry = bucket?.find(candidate => this.pointsEqual(candidate.point, callEdgePoint));
        return entry?.byReturnSite.get(returnSite) ?? [];
    }

    private getCallees(invokeStmt: ArkInvokeStmt): Set<ArkMethod> {
        const cached = this.calleeCache.get(invokeStmt);
        if (cached) {
            return cached;
        }

        const callees = resolveProjectMethods(this.scene, invokeStmt);
        const declaringFile = invokeStmt.getInvokeExpr()
            .getMethodSignature().getDeclaringClassSignature().getDeclaringFileSignature();
        if (this.scene.getFile(declaringFile)) {
            for (const callee of this.getAllCalleeMethods(invokeStmt)) {
                callees.add(callee);
            }
        } else {
            const recalled = getRecallMethodInParam(invokeStmt);
            if (recalled) callees.add(recalled);
        }
        this.calleeCache.set(invokeStmt, callees);
        return callees;
    }

    private edgeHashKey(edge: PathEdge<NullnessFact>): string {
        return `${this.statementId(edge.edgeStart.node)}:${edge.edgeStart.fact.hashCode()}>` +
            `${this.statementId(edge.edgeEnd.node)}:${edge.edgeEnd.fact.hashCode()}`;
    }

    private statementId(stmt: Stmt): number {
        const existing = this.statementIds.get(stmt);
        if (existing !== undefined) {
            return existing;
        }
        const id = this.nextStatementId++;
        this.statementIds.set(stmt, id);
        return id;
    }

    private edgesEqual(
        left: PathEdge<NullnessFact>,
        right: PathEdge<NullnessFact>
    ): boolean {
        return left.edgeStart.node === right.edgeStart.node &&
            left.edgeEnd.node === right.edgeEnd.node &&
            this.problem.factEqual(left.edgeStart.fact, right.edgeStart.fact) &&
            this.problem.factEqual(left.edgeEnd.fact, right.edgeEnd.fact);
    }

    private pointsEqual(
        left: PathEdgePoint<NullnessFact>,
        right: PathEdgePoint<NullnessFact>
    ): boolean {
        return left.node === right.node &&
            this.problem.factEqual(left.fact, right.fact);
    }

    protected isCallStatement(stmt: Stmt): boolean {
        if (super.isCallStatement(stmt)) return true;
        if (resolveProjectMethods(this.scene, stmt).size > 0) return true;
        if (!(stmt instanceof ArkAssignStmt)) return false;
        const invoke = stmt.getInvokeExpr();
        if (!invoke) return false;
        const methodName = invoke.getMethodSignature().getMethodSubSignature().getMethodName();
        return (methodName === 'then' || methodName === 'catch' || methodName === 'finally') &&
            invoke.getArgs().some(argument => argument.getType() instanceof FunctionType);
    }
}
