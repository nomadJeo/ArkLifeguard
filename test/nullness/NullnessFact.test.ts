import { describe, expect, it } from 'vitest';
import { NullConstant, NumberConstant, UndefinedConstant } from '../../src/adapter/arkanalyzer';
import { ArkAwaitExpr, ArkConditionExpr, ArkStaticInvokeExpr, RelationalBinaryOperator } from '../../src/adapter/arkanalyzer';
import { Local as ArkLocal } from '../../src/adapter/arkanalyzer';
import { ArkArrayRef, ClosureFieldRef } from '../../src/adapter/arkanalyzer';
import { ArkAssignStmt, ArkIfStmt, ArkInvokeStmt } from '../../src/adapter/arkanalyzer';
import { LexicalEnvType, UnknownType } from '../../src/adapter/arkanalyzer';
import { ClassSignature, MethodSignature, MethodSubSignature } from '../../src/adapter/arkanalyzer';
import {
    NullnessAccessPath,
    NullnessFact,
    NullnessKind,
    NullnessOriginKind,
    keepOnlyNull,
    keepOnlyUndefined,
    mayBeNull,
    mayBeUndefined,
    removeNull,
    removeNullish,
    removeUndefined,
} from '../../src/analysis/nullness/NullnessFact';
import { NullnessProblem } from '../../src/analysis/nullness/NullnessProblem';
import { NullnessSolver } from '../../src/analysis/nullness/NullnessSolver';

function local(name: string): any {
    return {
        getName: () => name,
        getType: () => ({ toString: () => 'MockType' }),
    };
}

function field(name: string): any {
    return {
        getFieldName: () => name,
        toString: () => `MockClass.${name}`,
    };
}

function stmt(line: number): any {
    return {
        getUses: () => [],
        getInvokeExpr: () => undefined,
        getOriginPositionInfo: () => ({
            getLineNo: () => line,
            getColNo: () => 1,
        }),
    };
}

function applyGuard(
    operator: RelationalBinaryOperator,
    literal: NullConstant | UndefinedConstant,
    kind: NullnessKind,
    trueBranch: boolean
): NullnessFact[] {
    const guardedLocal = new ArkLocal('guarded');
    const ifStmt = new ArkIfStmt(new ArkConditionExpr(guardedLocal, literal, operator));
    const trueTarget = stmt(20);
    const falseTarget = stmt(30);
    const trueBlock = { getStmts: () => [trueTarget] };
    const falseBlock = { getStmts: () => [falseTarget] };
    const sourceBlock = {
        getStmts: () => [ifStmt],
        getSuccessors: () => [trueBlock, falseBlock],
    };
    ifStmt.setCfg({
        getBlocks: () => new Set([sourceBlock, trueBlock, falseBlock]),
    } as any);

    const source = NullnessFact.create(
        NullnessAccessPath.fromValue(guardedLocal),
        kind,
        { kind: NullnessOriginKind.Unknown, stmt: stmt(10) }
    );
    const problem = new NullnessProblem(stmt(1), {} as any);
    return [...problem.getNormalFlowFunction(
        ifStmt,
        trueBranch ? trueTarget : falseTarget
    ).getDataFacts(source)];
}

describe('NullnessAccessPath', () => {
    it('represents locals and nested fields immutably', () => {
        const base = local('holder');
        const user = field('user');
        const name = field('name');
        const root = new NullnessAccessPath(base);
        const nested = root.appendField(user).appendField(name);

        expect(root.toString()).toBe('holder');
        expect(nested.toString()).toBe('holder.user.name');
        expect(nested.fields).toHaveLength(2);
        expect(root.isPrefixOf(nested)).toBe(true);
    });

    it('distinguishes empty and IFDS zero access paths', () => {
        const empty = NullnessAccessPath.getEmptyAccessPath();
        const zero = NullnessAccessPath.getZeroAccessPath();

        expect(empty).toBe(NullnessAccessPath.getEmptyAccessPath());
        expect(zero).toBe(NullnessAccessPath.getZeroAccessPath());
        expect(empty.isEmpty()).toBe(true);
        expect(empty.isZero()).toBe(false);
        expect(zero.isEmpty()).toBe(false);
        expect(zero.isZero()).toBe(true);
        expect(empty.equals(zero)).toBe(false);
    });

    it('uses local identity and field signatures for equality', () => {
        const sameBase = local('value');
        const first = new NullnessAccessPath(sameBase, null, [field('data')]);
        const second = new NullnessAccessPath(sameBase, null, [field('data')]);
        const differentScope = new NullnessAccessPath(local('value'), null, [field('data')]);

        expect(first.equals(second)).toBe(true);
        expect(first.hashCode()).toBe(second.hashCode());
        expect(first.equals(differentScope)).toBe(false);
    });

    it('creates paths from local and field-like values', () => {
        const base = local('this');
        const localPath = NullnessAccessPath.fromValue(base);
        const fieldPath = NullnessAccessPath.fromValue({
            getBase: () => base,
            getFieldSignature: () => field('session'),
        });

        expect(localPath.toString()).toBe('this');
        expect(fieldPath.toString()).toBe('this.session');
    });

    it('distinguishes constant array indices and summarizes dynamic indices', () => {
        const array = new ArkLocal('accounts');
        const zero = NullnessAccessPath.fromValue(
            new ArkArrayRef(array, new NumberConstant('0'))
        );
        const one = NullnessAccessPath.fromValue(
            new ArkArrayRef(array, new NumberConstant('1'))
        );
        const unknown = NullnessAccessPath.fromValue(
            new ArkArrayRef(array, new ArkLocal('index'))
        );

        expect(zero.toString()).toBe('accounts[0]');
        expect(one.toString()).toBe('accounts[1]');
        expect(zero.equals(one)).toBe(false);
        expect(unknown.toString()).toBe('accounts[*]');
        expect(zero.isPrefixOf(unknown)).toBe(true);
        expect(unknown.isPrefixOf(one)).toBe(true);
    });
});

describe('NullnessFact', () => {
    it('provides one stable IFDS zero fact', () => {
        const zero = NullnessFact.getZeroFact();

        expect(zero).toBe(NullnessFact.getZeroFact());
        expect(zero.isZeroFact()).toBe(true);
        expect(zero.getPropagationPath()).toEqual([]);
        expect(zero.toString()).toBe('ZERO');
    });

    it('creates a null fact with source provenance', () => {
        const sourceStmt = stmt(10);
        const fact = NullnessFact.create(
            new NullnessAccessPath(local('profile')),
            NullnessKind.Null,
            { kind: NullnessOriginKind.NullLiteral, stmt: sourceStmt }
        );

        expect(fact.isZeroFact()).toBe(false);
        expect(fact.kind).toBe(NullnessKind.Null);
        expect(fact.origin?.kind).toBe(NullnessOriginKind.NullLiteral);
        expect(fact.currentStmt).toBe(sourceStmt);
        expect(fact.toString()).toBe('null(profile)');
    });

    it('excludes provenance from semantic equality', () => {
        const base = local('profile');
        const path = new NullnessAccessPath(base);
        const first = NullnessFact.create(path, NullnessKind.Null, {
            kind: NullnessOriginKind.NullLiteral,
            stmt: stmt(10),
        });
        const second = NullnessFact.create(path, NullnessKind.Null, {
            kind: NullnessOriginKind.Unknown,
            stmt: stmt(20),
        });

        expect(first.equals(second)).toBe(true);
        expect(first.hashCode()).toBe(second.hashCode());
    });

    it('keeps unresolved return evidence separate from explicit nullable evidence', () => {
        const path = new NullnessAccessPath(local('result'));
        const explicit = NullnessFact.create(path, NullnessKind.MaybeNullish, {
            kind: NullnessOriginKind.LibraryModel,
            stmt: stmt(10),
        });
        const unresolved = NullnessFact.create(path, NullnessKind.MaybeNullish, {
            kind: NullnessOriginKind.UnresolvedReturn,
            stmt: stmt(20),
        });

        expect(explicit.equals(unresolved)).toBe(false);
        expect(explicit.hashCode()).not.toBe(unresolved.hashCode());
        expect(unresolved.isUnresolvedEvidence()).toBe(true);
    });

    it('keeps null and undefined as different facts', () => {
        const path = new NullnessAccessPath(local('value'));
        const source = stmt(3);
        const nullFact = NullnessFact.create(path, NullnessKind.Null, {
            kind: NullnessOriginKind.NullLiteral,
            stmt: source,
        });
        const undefinedFact = NullnessFact.create(path, NullnessKind.Undefined, {
            kind: NullnessOriginKind.UndefinedLiteral,
            stmt: source,
        });

        expect(nullFact.equals(undefinedFact)).toBe(false);
    });

    it('derives facts without mutating the predecessor', () => {
        const sourceStmt = stmt(10);
        const assignmentStmt = stmt(11);
        const useStmt = stmt(12);
        const source = NullnessFact.create(
            new NullnessAccessPath(local('original')),
            NullnessKind.Null,
            { kind: NullnessOriginKind.NullLiteral, stmt: sourceStmt }
        );
        const alias = source.deriveWithNewAccessPath(new NullnessAccessPath(local('alias')), assignmentStmt);
        const reachedUse = alias.deriveWithNewStmt(useStmt);

        expect(source.propagationDepth).toBe(0);
        expect(alias.propagationDepth).toBe(1);
        expect(reachedUse.propagationDepth).toBe(2);
        expect(reachedUse.predecessor).toBe(alias);
        expect(reachedUse.getPropagationPath()).toEqual([sourceStmt, assignmentStmt, useStmt]);
    });

    it('rejects empty paths and derivation from the zero fact', () => {
        expect(() => NullnessFact.create(
            NullnessAccessPath.getEmptyAccessPath(),
            NullnessKind.MaybeNull,
            { kind: NullnessOriginKind.Unknown, stmt: stmt(1) }
        )).toThrow(/non-empty/);
        expect(() => NullnessFact.getZeroFact().deriveWithNewStmt(stmt(2))).toThrow(/zero fact/);
    });
});

describe('NullnessKind narrowing', () => {
    it('distinguishes nullable and undefinable alternatives', () => {
        expect(mayBeNull(NullnessKind.MaybeNull)).toBe(true);
        expect(mayBeUndefined(NullnessKind.MaybeNull)).toBe(false);
        expect(mayBeNull(NullnessKind.MaybeUndefined)).toBe(false);
        expect(mayBeUndefined(NullnessKind.MaybeUndefined)).toBe(true);
        expect(mayBeNull(NullnessKind.MaybeNullish)).toBe(true);
        expect(mayBeUndefined(NullnessKind.MaybeNullish)).toBe(true);
    });

    it('removes only the alternative excluded by a strict guard', () => {
        expect(removeNull(NullnessKind.MaybeNullish)).toBe(NullnessKind.MaybeUndefined);
        expect(removeUndefined(NullnessKind.MaybeNullish)).toBe(NullnessKind.MaybeNull);
        expect(removeNull(NullnessKind.MaybeNull)).toBeNull();
        expect(removeUndefined(NullnessKind.MaybeUndefined)).toBeNull();
    });

    it('handles equality and loose null guards', () => {
        expect(keepOnlyNull(NullnessKind.MaybeNullish)).toBe(NullnessKind.Null);
        expect(keepOnlyUndefined(NullnessKind.MaybeNullish)).toBe(NullnessKind.Undefined);
        expect(keepOnlyNull(NullnessKind.MaybeUndefined)).toBeNull();
        expect(keepOnlyUndefined(NullnessKind.MaybeNull)).toBeNull();
        expect(removeNullish(NullnessKind.MaybeNullish)).toBeNull();
    });

    it('narrows strict null and undefined comparisons on CFG branches', () => {
        expect(applyGuard(
            RelationalBinaryOperator.StrictInequality,
            new NullConstant(),
            NullnessKind.MaybeNullish,
            true
        ).map(fact => fact.kind)).toEqual([NullnessKind.MaybeUndefined]);
        expect(applyGuard(
            RelationalBinaryOperator.StrictInequality,
            new UndefinedConstant(),
            NullnessKind.MaybeNullish,
            true
        ).map(fact => fact.kind)).toEqual([NullnessKind.MaybeNull]);
        expect(applyGuard(
            RelationalBinaryOperator.StrictInequality,
            new NullConstant(),
            NullnessKind.MaybeNullish,
            false
        ).map(fact => fact.kind)).toEqual([NullnessKind.Null]);
    });

    it('removes both nullish alternatives after a loose non-null guard', () => {
        expect(applyGuard(
            RelationalBinaryOperator.InEquality,
            new NullConstant(),
            NullnessKind.MaybeNullish,
            true
        )).toEqual([]);
        expect(applyGuard(
            RelationalBinaryOperator.InEquality,
            new UndefinedConstant(),
            NullnessKind.MaybeNullish,
            true
        )).toEqual([]);
    });
});

describe('Nullness IFDS scaffold', () => {
    it('folds overlong access paths into a field-anchored wildcard suffix', () => {
        const base = local('root');
        const concrete = new NullnessAccessPath(
            base,
            null,
            [field('first'), field('second'), field('third')]
        );
        const widened = concrete.truncateWithWildcard(2);

        expect(widened.toString()).toBe('root.first.*{second}');
        expect(widened.isPrefixOf(concrete)).toBe(true);
        expect(widened.fields).toHaveLength(2);
        const parent = new NullnessAccessPath(
            base,
            null,
            [field('first'), field('second')]
        );
        expect(parent.isPrefixOf(widened)).toBe(true);
        expect(widened.remainingFieldsAfter(parent)).toHaveLength(1);
        expect(widened.isPrefixOf(new NullnessAccessPath(
            base,
            null,
            [field('first'), field('sibling'), field('third')]
        ))).toBe(false);
    });

    it('widens recursive entry kinds without inventing the other nullish category', () => {
        const source = NullnessFact.create(
            new NullnessAccessPath(local('value')),
            NullnessKind.Undefined,
            { kind: NullnessOriginKind.UndefinedLiteral, stmt: stmt(1) }
        );

        const widened = source.widenKindForRecursion();
        expect(widened.kind).toBe(NullnessKind.MaybeUndefined);
        expect(widened.accessPath.equals(source.accessPath)).toBe(true);
    });

    it('retains approximation evidence after a wildcard path is rebound', () => {
        const source = NullnessFact.create(
            new NullnessAccessPath(
                local('root'),
                null,
                [field('first'), field('second'), field('third')]
            ),
            NullnessKind.Null,
            { kind: NullnessOriginKind.NullLiteral, stmt: stmt(1) }
        );

        const widened = source.abstractAccessPath(2);
        const rebound = widened.deriveWithNewAccessPath(
            new NullnessAccessPath(local('temporary')),
            stmt(2)
        );

        expect(source.isApproximateEvidence()).toBe(false);
        expect(widened.isApproximateEvidence()).toBe(true);
        expect(rebound.isApproximateEvidence()).toBe(true);
    });

    it('uses semantic fact equality and safe placeholder flow functions', () => {
        const entry = stmt(1);
        const method = {} as any;
        const problem = new NullnessProblem(entry, method);
        const source = NullnessFact.create(
            new NullnessAccessPath(local('value')),
            NullnessKind.Null,
            { kind: NullnessOriginKind.NullLiteral, stmt: entry }
        );
        const equivalent = NullnessFact.create(
            source.accessPath,
            NullnessKind.Null,
            { kind: NullnessOriginKind.Unknown, stmt: stmt(2) }
        );

        expect(problem.factEqual(source, equivalent)).toBe(true);
        expect(problem.getNormalFlowFunction(entry, entry).getDataFacts(source)).toEqual(new Set([source]));
        expect(problem.getCallFlowFunction(entry, method).getDataFacts(source)).toEqual(new Set());
        expect(problem.getCallFlowFunction(entry, method).getDataFacts(problem.createZeroValue()))
            .toEqual(new Set([problem.createZeroValue()]));
        expect(problem.getConfig().maxAccessPathLength).toBe(5);
        expect(NullnessSolver).toBeTypeOf('function');
    });

    it('maps a captured caller fact through the callee lexical environment', () => {
        const entry = stmt(1);
        const capturedCallerLocal = new ArkLocal('account');
        const lexicalEnvType = new LexicalEnvType({} as any, [capturedCallerLocal]);
        const callerClosureArgument = new ArkLocal('%closures0', lexicalEnvType);
        const calleeClosureLocal = new ArkLocal('%closures0', lexicalEnvType);
        const capturedCalleeLocal = new ArkLocal('account');
        const closureFieldRef = new ClosureFieldRef(
            calleeClosureLocal,
            'account',
            capturedCallerLocal.getType()
        );
        const loadCapturedLocal = new ArkAssignStmt(capturedCalleeLocal, closureFieldRef);
        const callee = {
            getCfg: () => ({
                getStartingBlock: () => ({ getStmts: () => [loadCapturedLocal] }),
            }),
        } as any;
        const callSignature = new MethodSignature(
            ClassSignature.DEFAULT,
            new MethodSubSignature('invokeClosure', [], UnknownType.getInstance(), true)
        );
        const callStmt = new ArkInvokeStmt(new ArkStaticInvokeExpr(
            callSignature,
            [callerClosureArgument]
        ));
        const problem = new NullnessProblem(entry, {} as any);
        const source = NullnessFact.create(
            NullnessAccessPath.fromValue(capturedCallerLocal),
            NullnessKind.Null,
            { kind: NullnessOriginKind.NullLiteral, stmt: entry }
        );

        const mapped = [...problem.getCallFlowFunction(callStmt, callee).getDataFacts(source)];
        expect(mapped).toHaveLength(1);
        expect(mapped[0].accessPath.toString()).toBe('%closures0.account');

        const afterClosureLoad = [
            ...problem.getNormalFlowFunction(loadCapturedLocal, stmt(2)).getDataFacts(mapped[0]),
        ];
        expect(afterClosureLoad.some(fact =>
            fact.accessPath.equals(NullnessAccessPath.fromValue(capturedCalleeLocal))
        )).toBe(true);
    });

    it('propagates a fact through an ArkAwaitExpr assignment', () => {
        const entry = stmt(1);
        const promiseResult = new ArkLocal('%promiseResult');
        const account = new ArkLocal('account');
        const awaitAssignment = new ArkAssignStmt(
            account,
            new ArkAwaitExpr(promiseResult)
        );
        const problem = new NullnessProblem(entry, {} as any);
        const source = NullnessFact.create(
            NullnessAccessPath.fromValue(promiseResult),
            NullnessKind.Null,
            { kind: NullnessOriginKind.NullLiteral, stmt: entry }
        );

        const propagated = [
            ...problem.getNormalFlowFunction(awaitAssignment, stmt(2)).getDataFacts(source),
        ];
        expect(propagated.some(fact =>
            fact.accessPath.equals(NullnessAccessPath.fromValue(account))
        )).toBe(true);
    });
});
