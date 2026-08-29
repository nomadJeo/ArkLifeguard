import type { Stmt } from '../adapter/arkanalyzer';
import type { FactSemantics } from './FactSemantics';
import { PathEdge } from './Edge';

type EndFactIndex<D> = Map<number, PathEdge<D>[]>;
type StartFactIndex<D> = Map<number, EndFactIndex<D>>;
type EndNodeIndex<D> = Map<Stmt, StartFactIndex<D>>;

export interface PathEdgeInsertResult {
    inserted: boolean;
    candidateChecks: number;
    factEqualityChecks: number;
}

/** Stores path edges and performs collision-safe semantic deduplication. */
export class PathEdgeStore<D> {
    private readonly edges = new Set<PathEdge<D>>();
    private readonly index = new Map<Stmt, EndNodeIndex<D>>();

    constructor(private readonly semantics: FactSemantics<D>) {}

    addIfAbsent(edge: PathEdge<D>): PathEdgeInsertResult {
        const bucket = this.getBucket(edge, false);
        let candidateChecks = 0;
        let factEqualityChecks = 0;
        for (const existing of bucket ?? []) {
            candidateChecks++;
            factEqualityChecks++;
            if (!this.semantics.factEqual(
                existing.edgeEnd.fact,
                edge.edgeEnd.fact
            )) continue;
            factEqualityChecks++;
            if (this.semantics.factEqual(
                existing.edgeStart.fact,
                edge.edgeStart.fact
            )) {
                return { inserted: false, candidateChecks, factEqualityChecks };
            }
        }

        this.edges.add(edge);
        this.getBucket(edge, true)!.push(edge);
        return { inserted: true, candidateChecks, factEqualityChecks };
    }

    containsEndPoint(node: Stmt, fact: D): boolean {
        for (const edge of this.edges) {
            if (edge.edgeEnd.node === node &&
                this.semantics.factEqual(edge.edgeEnd.fact, fact)) {
                return true;
            }
        }
        return false;
    }

    values(): ReadonlySet<PathEdge<D>> {
        return this.edges;
    }

    asSet(): Set<PathEdge<D>> {
        return this.edges;
    }

    get size(): number {
        return this.edges.size;
    }

    private getBucket(
        edge: PathEdge<D>,
        create: boolean
    ): PathEdge<D>[] | undefined {
        let byEndNode = this.index.get(edge.edgeStart.node);
        if (!byEndNode) {
            if (!create) return undefined;
            byEndNode = new Map();
            this.index.set(edge.edgeStart.node, byEndNode);
        }

        let byStartFact = byEndNode.get(edge.edgeEnd.node);
        if (!byStartFact) {
            if (!create) return undefined;
            byStartFact = new Map();
            byEndNode.set(edge.edgeEnd.node, byStartFact);
        }

        const startHash = this.semantics.factHash(edge.edgeStart.fact);
        let byEndFact = byStartFact.get(startHash);
        if (!byEndFact) {
            if (!create) return undefined;
            byEndFact = new Map();
            byStartFact.set(startHash, byEndFact);
        }

        const endHash = this.semantics.factHash(edge.edgeEnd.fact);
        let bucket = byEndFact.get(endHash);
        if (!bucket && create) {
            bucket = [];
            byEndFact.set(endHash, bucket);
        }
        return bucket;
    }
}
