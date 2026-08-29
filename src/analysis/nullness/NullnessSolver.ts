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
import type { DataflowSolverOptions } from '../../ifds';
import { NullnessFact } from './NullnessFact';
import { NullnessProblem } from './NullnessProblem';
import { resolveProjectMethods } from './ProjectMethodResolver';

export interface NullnessSolverRoot {
    entryPoint: Stmt;
    entryMethod: ArkMethod;
}

/** Thin typed facade over ArkAnalyzer's generic IFDS solver. */
export class NullnessSolver extends DataflowSolver<NullnessFact> {
    /** Callee resolution depends on the invoke statement, never on the input fact. */
    private readonly calleeCache = new Map<ArkInvokeStmt, Set<ArkMethod>>();
    private readonly recursiveMethods: Set<ArkMethod>;
    private readonly largeProjectWidening: boolean;

    private readonly rootMethods: Set<ArkMethod>;

    constructor(
        problem: NullnessProblem,
        scene: Scene,
        private readonly additionalRoots: readonly NullnessSolverRoot[] = [],
        options: DataflowSolverOptions = {}
    ) {
        super(problem, scene, options);
        this.recursiveMethods = this.findRecursiveMethods(scene);
        this.largeProjectWidening = scene.getMethods().length >=
            problem.getConfig().largeProjectWideningThreshold;
        this.rootMethods = new Set([
            problem.getEntryMethod(),
            ...additionalRoots.map(root => root.entryMethod),
        ]);
    }

    protected init(): void {
        this.calleeCache.clear();
        super.init();
        for (const root of this.additionalRoots) {
            const rootPoint = new PathEdgePoint(root.entryPoint, this.zeroFact);
            this.propagate(new PathEdge(rootPoint, rootPoint));
        }
    }

    protected prepareEdgeForPropagation(
        edge: PathEdge<NullnessFact>
    ): PathEdge<NullnessFact> | null {
        edge = this.abstractEdgeFacts(edge);
        if (!edge.edgeEnd.fact.isZeroFact() &&
            edge.edgeEnd.fact.propagationDepth >
                (this.problem as NullnessProblem).getConfig().maxPropagationDepth) {
            return null;
        }
        return edge;
    }

    protected processExitNode(edge: PathEdge<NullnessFact>): void {
        const startEdgePoint = edge.edgeStart;
        const exitEdgePoint = edge.edgeEnd;
        this.summaryStore.addEndSummary(startEdgePoint, exitEdgePoint);

        const callerEdges = this.summaryStore.getIncoming(startEdgePoint);
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
                if (!this.summaryStore.addCallSummary(callEdgePoint, returnSitePoint)) {
                    continue;
                }
                this.applySummaryToIncomingCallers(
                    callerEdges,
                    callEdgePoint,
                    returnSitePoint
                );
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
        for (const summaryPoint of this.summaryStore.getCallSummaries(
            callEdgePoint,
            returnSite
        )) {
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
        this.summaryStore.addIncoming(startEdgePoint, edge);

        for (const exitEdgePoint of this.summaryStore.getEndSummaries(startEdgePoint)) {
            const returnFlow = this.problem.getExitToReturnFlowFunction(
                exitEdgePoint.node,
                returnSite,
                callEdgePoint.node
            );
            for (const returnFact of returnFlow.getDataFacts(exitEdgePoint.fact)) {
                this.summaryStore.addCallSummary(
                    callEdgePoint,
                    new PathEdgePoint(returnSite, returnFact)
                );
            }
        }
    }

    getReachedFacts(): Map<Stmt, NullnessFact[]> {
        const reached = new Map<Stmt, NullnessFact[]>();
        const reachedIndex = new Map<Stmt, Map<number, NullnessFact[]>>();
        for (const edge of this.pathEdgeStore.values()) {
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
