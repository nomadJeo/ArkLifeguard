import type { Stmt } from "../adapter/arkanalyzer";
import { PathEdge, PathEdgePoint } from "./PathEdge";
import type { FactSemantics } from "./FactSemantics";

interface PointEntry<D, V> {
  point: PathEdgePoint<D>;
  value: V;
}

interface ReturnSummaries<D> {
  points: PathEdgePoint<D>[];
  byFactHash: Map<number, PathEdgePoint<D>[]>;
}

interface CallSummaryEntry<D> {
  byReturnSite: Map<Stmt, ReturnSummaries<D>>;
}

class SemanticPointMap<D, V> {
  private readonly index = new Map<Stmt, Map<number, PointEntry<D, V>[]>>();

  constructor(private readonly semantics: FactSemantics<D>) {}

  get(point: PathEdgePoint<D>): V | undefined {
    const bucket = this.index
      .get(point.node)
      ?.get(this.semantics.factHash(point.fact));
    return bucket?.find((entry) => this.pointsEqual(entry.point, point))?.value;
  }

  getOrCreate(point: PathEdgePoint<D>, create: () => V): V {
    let byFactHash = this.index.get(point.node);
    if (!byFactHash) {
      byFactHash = new Map();
      this.index.set(point.node, byFactHash);
    }
    const hash = this.semantics.factHash(point.fact);
    let bucket = byFactHash.get(hash);
    const existing = bucket?.find((entry) =>
      this.pointsEqual(entry.point, point),
    );
    if (existing) return existing.value;

    const value = create();
    const entry = { point, value };
    if (bucket) {
      bucket.push(entry);
    } else {
      bucket = [entry];
      byFactHash.set(hash, bucket);
    }
    return value;
  }

  clear(): void {
    this.index.clear();
  }

  private pointsEqual(
    left: PathEdgePoint<D>,
    right: PathEdgePoint<D>,
  ): boolean {
    return (
      left.node === right.node &&
      this.semantics.factEqual(left.fact, right.fact)
    );
  }
}

/** Owns collision-safe incoming, end-summary and call-summary state. */
export class SummaryStore<D> {
  private readonly incoming: SemanticPointMap<D, Set<PathEdge<D>>>;
  private readonly endSummaries: SemanticPointMap<D, Set<PathEdgePoint<D>>>;
  private readonly callSummaries: SemanticPointMap<D, CallSummaryEntry<D>>;

  constructor(private readonly semantics: FactSemantics<D>) {
    this.incoming = new SemanticPointMap(semantics);
    this.endSummaries = new SemanticPointMap(semantics);
    this.callSummaries = new SemanticPointMap(semantics);
  }

  addIncoming(calleeEntry: PathEdgePoint<D>, callerEdge: PathEdge<D>): void {
    this.incoming.getOrCreate(calleeEntry, () => new Set()).add(callerEdge);
  }

  getIncoming(
    calleeEntry: PathEdgePoint<D>,
  ): ReadonlySet<PathEdge<D>> | undefined {
    return this.incoming.get(calleeEntry);
  }

  addEndSummary(entry: PathEdgePoint<D>, exit: PathEdgePoint<D>): void {
    this.endSummaries.getOrCreate(entry, () => new Set()).add(exit);
  }

  getEndSummaries(entry: PathEdgePoint<D>): ReadonlySet<PathEdgePoint<D>> {
    return this.endSummaries.get(entry) ?? new Set();
  }

  addCallSummary(
    callPoint: PathEdgePoint<D>,
    returnPoint: PathEdgePoint<D>,
  ): boolean {
    const entry = this.callSummaries.getOrCreate(callPoint, () => ({
      byReturnSite: new Map(),
    }));
    let summaries = entry.byReturnSite.get(returnPoint.node);
    if (!summaries) {
      summaries = { points: [], byFactHash: new Map() };
      entry.byReturnSite.set(returnPoint.node, summaries);
    }

    const hash = this.semantics.factHash(returnPoint.fact);
    const bucket = summaries.byFactHash.get(hash);
    if (
      bucket?.some((existing) =>
        this.semantics.factEqual(existing.fact, returnPoint.fact),
      )
    ) {
      return false;
    }
    summaries.points.push(returnPoint);
    if (bucket) {
      bucket.push(returnPoint);
    } else {
      summaries.byFactHash.set(hash, [returnPoint]);
    }
    return true;
  }

  getCallSummaries(
    callPoint: PathEdgePoint<D>,
    returnSite: Stmt,
  ): readonly PathEdgePoint<D>[] {
    return (
      this.callSummaries.get(callPoint)?.byReturnSite.get(returnSite)?.points ??
      []
    );
  }

  clear(): void {
    this.incoming.clear();
    this.endSummaries.clear();
    this.callSummaries.clear();
  }
}
