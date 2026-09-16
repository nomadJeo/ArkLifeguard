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
import { Stmt } from '../../adapter/arkanalyzer';
import { PathEdge, PathEdgePoint } from '../../ifds';
import { ArkMethod } from '../../adapter/arkanalyzer';
// Import through ArkAnalyzer's public barrel. Directly loading DataflowSolver before
// Scene is initialized exposes the existing ArkFile -> src/index circular dependency.
import { DataflowSolver } from '../../ifds';
import type { DataflowSolverOptions } from '../../ifds';
import { NullnessFact } from './NullnessFact';
import { NullnessProblem } from './NullnessProblem';
import { resolveProjectMethods } from './ProjectMethodResolver';
import { NullnessInterproceduralCFG } from './NullnessInterproceduralCFG';

export interface NullnessSolverRoot {
    entryPoint: Stmt;
    entryMethod: ArkMethod;
}

/** Thin typed facade over ArkAnalyzer's generic IFDS solver. */
export class NullnessSolver extends DataflowSolver<NullnessFact> {
    private readonly recursiveMethods: Set<ArkMethod>;
    private readonly largeProjectWidening: boolean;

    private readonly rootMethods: Set<ArkMethod>;

    constructor(
        problem: NullnessProblem,
        scene: Scene,
        private readonly additionalRoots: readonly NullnessSolverRoot[] = [],
        options: DataflowSolverOptions = {}
    ) {
        super(problem, scene, options, new NullnessInterproceduralCFG(scene));
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

    protected isRootMethod(method: ArkMethod): boolean {
        return this.rootMethods.has(method);
    }

    protected createCalleeStartPoint(
        firstStmt: Stmt,
        fact: NullnessFact
    ): PathEdgePoint<NullnessFact> {
        const rawPoint = new PathEdgePoint(firstStmt, fact);
        return new PathEdgePoint(
            firstStmt,
            this.abstractPointFact(rawPoint, true)
        );
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

}
