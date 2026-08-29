import { describe, expect, it } from 'vitest';
import type { Stmt } from '../../src/adapter/arkanalyzer';
import {
    PathEdge,
    PathEdgePoint,
    PathEdgeStore,
    SummaryStore,
    type FactSemantics,
} from '../../src/ifds';

interface TestFact {
    value: string;
}

const semantics: FactSemantics<TestFact> = {
    factEqual: (left, right) => left.value === right.value,
    // Equal-length values intentionally collide in these tests.
    factHash: fact => fact.value.length,
};

const fact = (value: string): TestFact => ({ value });
const point = (node: Stmt, value: string): PathEdgePoint<TestFact> =>
    new PathEdgePoint(node, fact(value));

describe('IFDS stores', () => {
    it('deduplicates PathEdges semantically and keeps hash collisions distinct', () => {
        const startNode = {} as Stmt;
        const endNode = {} as Stmt;
        const store = new PathEdgeStore(semantics);
        const edge = (value: string): PathEdge<TestFact> => new PathEdge(
            point(startNode, 'ROOT'),
            point(endNode, value)
        );

        expect(store.addIfAbsent(edge('AA')).inserted).toBe(true);
        expect(store.addIfAbsent(edge('AA'))).toMatchObject({
            inserted: false,
            candidateChecks: 1,
            factEqualityChecks: 2,
        });
        expect(store.addIfAbsent(edge('BB'))).toMatchObject({
            inserted: true,
            candidateChecks: 1,
            factEqualityChecks: 1,
        });

        expect(store.size).toBe(2);
        expect(store.containsEndPoint(endNode, fact('AA'))).toBe(true);
        expect(store.containsEndPoint(endNode, fact('CC'))).toBe(false);
    });

    it('indexes incoming, end and call summaries by semantic points', () => {
        const callNode = {} as Stmt;
        const calleeNode = {} as Stmt;
        const exitNode = {} as Stmt;
        const returnNode = {} as Stmt;
        const store = new SummaryStore(semantics);
        const callerEdge = new PathEdge(
            point(callNode, 'ROOT'),
            point(callNode, 'CALL')
        );

        store.addIncoming(point(calleeNode, 'ENTRY'), callerEdge);
        expect(store.getIncoming(point(calleeNode, 'ENTRY'))?.has(callerEdge)).toBe(true);
        expect(store.getIncoming(point(calleeNode, 'OTHER'))).toBeUndefined();

        store.addEndSummary(point(calleeNode, 'ENTRY'), point(exitNode, 'EXIT'));
        expect([...store.getEndSummaries(point(calleeNode, 'ENTRY'))])
            .toHaveLength(1);

        const callPoint = point(callNode, 'CALL');
        expect(store.addCallSummary(callPoint, point(returnNode, 'AA'))).toBe(true);
        expect(store.addCallSummary(point(callNode, 'CALL'), point(returnNode, 'AA')))
            .toBe(false);
        expect(store.addCallSummary(point(callNode, 'CALL'), point(returnNode, 'BB')))
            .toBe(true);
        expect(store.getCallSummaries(point(callNode, 'CALL'), returnNode)
            .map(summary => summary.fact.value)).toEqual(['AA', 'BB']);
    });
});
