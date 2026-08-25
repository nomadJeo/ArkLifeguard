/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import type { Scene } from '../../../adapter/arkanalyzer';
import { NullConstant, UndefinedConstant } from '../../../adapter/arkanalyzer';
import { Local } from '../../../adapter/arkanalyzer';
import { GlobalRef } from '../../../adapter/arkanalyzer';
import { ArkAssignStmt, ArkReturnStmt, Stmt } from '../../../adapter/arkanalyzer';
import { NullType, UndefinedType, UnionType } from '../../../adapter/arkanalyzer';
import { Value } from '../../../adapter/arkanalyzer';
import { BasicBlock } from '../../../adapter/arkanalyzer';
import { ModifierType } from '../../../adapter/arkanalyzer';
import { ArkMethod } from '../../../adapter/arkanalyzer';
import {
    NullnessAccessPath,
    NullnessFact,
    NullnessKind,
    NullnessOriginKind,
} from '../NullnessFact';
import { resolveProjectMethods } from '../ProjectMethodResolver';
import { NullnessLibrarySummary } from './NullnessLibrarySummary';

interface ReturnAlternatives {
    null: boolean;
    undefined: boolean;
    nonNull: boolean;
    unresolved: boolean;
    sourceStmt?: Stmt;
}

interface MethodReturnContract {
    kind: NullnessKind | 'non-null';
    sourceStmt: Stmt;
}

interface ReturnLocation {
    block: BasicBlock;
    index: number;
}

interface MethodCfgIndex {
    returnLocations: Map<Stmt, ReturnLocation>;
    lastLocalDefinitionByBlock: Map<BasicBlock, Map<string, Value>>;
}

/** Bounded, intraprocedural return contract for project-defined methods. */
export class ProjectMethodReturnSummary implements NullnessLibrarySummary {
    readonly id = 'project-method-return';
    private readonly callCache = new WeakMap<Stmt, MethodReturnContract | null>();
    private readonly methodCache = new WeakMap<ArkMethod, MethodReturnContract | null>();
    private readonly methodCfgIndexCache = new WeakMap<ArkMethod, MethodCfgIndex>();

    constructor(private readonly scene: Scene) {}

    matches(callStmt: Stmt): boolean {
        return this.getCallContract(callStmt) !== null;
    }

    getCallToReturnFacts(callStmt: Stmt, inputFact: NullnessFact): Set<NullnessFact> {
        if (!inputFact.isZeroFact() || !(callStmt instanceof ArkAssignStmt)) {
            return new Set();
        }
        const contract = this.getCallContract(callStmt);
        if (!contract || contract.kind === 'non-null') return new Set();

        const resultPath = NullnessAccessPath.fromValue(callStmt.getLeftOp());
        if (resultPath.isEmpty()) return new Set();
        return new Set([NullnessFact.create(resultPath, contract.kind, {
            kind: NullnessOriginKind.NullableReturn,
            stmt: contract.sourceStmt,
            description: 'project method has a nullish return path',
        })]);
    }

    suppressesLiteralReturns(callStmt: Stmt): boolean {
        return [...resolveProjectMethods(this.scene, callStmt)].some(method =>
            this.getOverloadContract(method, callStmt)?.kind === 'non-null');
    }

    private getCallContract(callStmt: Stmt): MethodReturnContract | null {
        const cached = this.callCache.get(callStmt);
        if (cached !== undefined) return cached;

        const alternatives: ReturnAlternatives = {
            null: false,
            undefined: false,
            nonNull: false,
            unresolved: false,
        };
        for (const method of resolveProjectMethods(this.scene, callStmt)) {
            const contract = this.getOverloadContract(method, callStmt) ??
                this.getMethodContract(method);
            if (!contract) continue;
            alternatives.sourceStmt ??= contract.sourceStmt;
            if (contract.kind === 'non-null') {
                alternatives.nonNull = true;
            } else {
                alternatives.null ||= contract.kind === NullnessKind.Null ||
                    contract.kind === NullnessKind.MaybeNull ||
                    contract.kind === NullnessKind.MaybeNullish;
                alternatives.undefined ||= contract.kind === NullnessKind.Undefined ||
                    contract.kind === NullnessKind.MaybeUndefined ||
                    contract.kind === NullnessKind.MaybeNullish;
            }
        }

        const contract = alternatives.sourceStmt
            ? { kind: this.toKind(alternatives), sourceStmt: alternatives.sourceStmt }
            : null;
        this.callCache.set(callStmt, contract);
        return contract;
    }

    /**
     * Prefer a matching overload declaration when it gives a stronger contract
     * than the implementation signature.  This is common for helpers such as
     * `getChildNode(node, tag, errorMessage)`: the two-argument overload is
     * nullable, while the three-argument overload throws instead of returning
     * null.  Treating the implementation's union return as every call's return
     * type creates an infeasible nullable path.
     */
    private getOverloadContract(
        method: ArkMethod,
        callStmt: Stmt
    ): MethodReturnContract | null {
        const declarations = method.getDeclareSignatures();
        const invoke = callStmt.getInvokeExpr();
        if (!declarations || declarations.length === 0 || !invoke) return null;

        const argumentCount = invoke.getArgs().length;
        const matching = declarations.filter(signature => {
            const parameters = signature.getMethodSubSignature().getParameters();
            const required = parameters.filter(parameter => !parameter.isOptional()).length;
            return argumentCount >= required && argumentCount <= parameters.length;
        });
        if (matching.length === 0 || matching.some(signature =>
            this.typeMayBeNullish(signature.getMethodSubSignature().getReturnType()))) {
            return null;
        }
        const sourceStmt = method.getCfg()?.getStartingStmt() ??
            method.getCfg()?.getStartingBlock()?.getHead();
        return sourceStmt ? { kind: 'non-null', sourceStmt } : null;
    }

    private typeMayBeNullish(type: unknown): boolean {
        if (type instanceof NullType || type instanceof UndefinedType) return true;
        return type instanceof UnionType && type.getTypes().some(member =>
            this.typeMayBeNullish(member));
    }

    private getMethodContract(method: ArkMethod): MethodReturnContract | null {
        const cached = this.methodCache.get(method);
        if (cached !== undefined) return cached;
        if (!method.getCfg() || method.containsModifier(ModifierType.ASYNC)) {
            this.methodCache.set(method, null);
            return null;
        }

        const alternatives: ReturnAlternatives = {
            null: false,
            undefined: false,
            nonNull: false,
            unresolved: false,
        };
        let fallbackStmt: Stmt | undefined;
        for (const stmt of method.getReturnStmt()) {
            if (!(stmt instanceof ArkReturnStmt)) continue;
            fallbackStmt ??= stmt;
            const hadNullish = alternatives.null || alternatives.undefined;
            this.classifyReturnValue(method, stmt, stmt.getOp(), alternatives);
            if (!hadNullish && (alternatives.null || alternatives.undefined)) {
                alternatives.sourceStmt = stmt;
            }
        }
        alternatives.sourceStmt ??= fallbackStmt;
        if (alternatives.unresolved &&
            (alternatives.null || alternatives.undefined)) {
            alternatives.nonNull = true;
        }
        const contract = alternatives.sourceStmt && !(
            alternatives.unresolved &&
            !alternatives.null &&
            !alternatives.undefined &&
            !alternatives.nonNull
        )
            ? { kind: this.toKind(alternatives), sourceStmt: alternatives.sourceStmt }
            : null;
        this.methodCache.set(method, contract);
        return contract;
    }

    /** Classify the definitions that can actually reach this return statement. */
    private classifyReturnValue(
        method: ArkMethod,
        returnStmt: ArkReturnStmt,
        value: Value,
        alternatives: ReturnAlternatives
    ): void {
        if (!(value instanceof Local)) {
            this.classifyValue(value, alternatives, new Set());
            return;
        }
        const cfg = method.getCfg();
        if (!cfg) {
            this.classifyValue(value, alternatives, new Set());
            return;
        }
        const cfgIndex = this.getMethodCfgIndex(method);
        const returnLocation = cfgIndex.returnLocations.get(returnStmt);
        if (!returnLocation) {
            this.classifyValue(value, alternatives, new Set());
            return;
        }

        const definitions = this.collectReachingDefinitions(
            returnLocation.block,
            returnLocation.index - 1,
            value,
            cfgIndex
        );
        if (definitions.length === 0) {
            // A top-level function can return a module Local whose assignment
            // lives in the ArkFile default method (`%dflt`), not in the
            // function CFG.  ArkAnalyzer does not attach that assignment as
            // the Local's declaring statement, so treating every missing
            // intraprocedural definition as `undefined` turns initialized
            // module constants into false nullable returns.
            const moduleDefinitions = this.collectModuleLevelDefinitions(method, value);
            if (moduleDefinitions.length === 0) {
                if (this.isModuleLevelReference(method, value)) {
                    alternatives.undefined = true;
                } else {
                    // Failure to recover a local reaching definition is not
                    // evidence that the value is definitely undefined.  Keep
                    // any explicit nullable alternatives, but otherwise leave
                    // the return unresolved and unreported by default.
                    alternatives.unresolved = true;
                    if (alternatives.null || alternatives.undefined) {
                        alternatives.nonNull = true;
                    }
                }
                return;
            }
            for (const definition of moduleDefinitions) {
                this.classifyValue(definition, alternatives, new Set());
            }
            return;
        }
        for (const definition of definitions) {
            this.classifyValue(definition, alternatives, new Set());
        }
    }

    /**
     * Bounded backwards reaching-definition walk for one returned Local. The
     * first assignment in each predecessor block is sufficient. A block can be
     * shared by exponentially many CFG paths, but visiting it more than once
     * cannot add another reaching definition for the same Local. Keep one
     * method-wide block index and traverse each reachable predecessor once.
     */
    private collectReachingDefinitions(
        block: BasicBlock,
        startIndex: number,
        local: Local,
        cfgIndex: MethodCfgIndex
    ): Value[] {
        const definitions = new Set<Value>();
        const visited = new Set<BasicBlock>();
        const workList: Array<{ block: BasicBlock; startIndex: number }> = [
            { block, startIndex },
        ];

        while (workList.length > 0) {
            const current = workList.pop()!;
            if (visited.has(current.block)) continue;
            visited.add(current.block);

            const definition = this.findLastLocalDefinition(
                current.block,
                current.startIndex,
                local,
                cfgIndex
            );
            if (definition) {
                definitions.add(definition);
                continue;
            }

            for (const predecessor of current.block.getPredecessors()) {
                workList.push({
                    block: predecessor,
                    startIndex: predecessor.getStmts().length - 1,
                });
            }
        }

        return [...definitions];
    }

    private findLastLocalDefinition(
        block: BasicBlock,
        startIndex: number,
        local: Local,
        cfgIndex: MethodCfgIndex
    ): Value | undefined {
        const stmts = block.getStmts();
        const boundedStart = Math.min(startIndex, stmts.length - 1);
        if (boundedStart === stmts.length - 1) {
            return cfgIndex.lastLocalDefinitionByBlock.get(block)?.get(local.getName());
        }
        for (let index = boundedStart; index >= 0; index--) {
            const stmt = stmts[index];
            if (stmt instanceof ArkAssignStmt && this.sameMethodLocal(
                stmt.getLeftOp(),
                local
            )) {
                return stmt.getRightOp();
            }
        }
        return undefined;
    }

    private getMethodCfgIndex(method: ArkMethod): MethodCfgIndex {
        const cached = this.methodCfgIndexCache.get(method);
        if (cached) return cached;

        const returnLocations = new Map<Stmt, ReturnLocation>();
        const lastLocalDefinitionByBlock = new Map<BasicBlock, Map<string, Value>>();
        for (const block of method.getCfg()?.getBlocks() ?? []) {
            const definitions = new Map<string, Value>();
            const stmts = block.getStmts();
            for (let index = 0; index < stmts.length; index++) {
                const stmt = stmts[index];
                if (stmt instanceof ArkReturnStmt) {
                    returnLocations.set(stmt, { block, index });
                }
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const leftOp = stmt.getLeftOp();
                if (leftOp instanceof Local) {
                    definitions.set(leftOp.getName(), stmt.getRightOp());
                }
            }
            lastLocalDefinitionByBlock.set(block, definitions);
        }

        const index = { returnLocations, lastLocalDefinitionByBlock };
        this.methodCfgIndexCache.set(method, index);
        return index;
    }

    private sameMethodLocal(value: Value, local: Local): boolean {
        return value === local || value instanceof Local &&
            value.getName() === local.getName();
    }

    private isModuleLevelReference(method: ArkMethod, local: Local): boolean {
        return method.getBody()?.getUsedGlobals()?.has(local.getName()) ?? false;
    }

    /** Find same-file top-level assignments lowered into the ArkFile default method. */
    private collectModuleLevelDefinitions(method: ArkMethod, local: Local): Value[] {
        const defaultMethod = method.getDeclaringArkFile()
            .getDefaultClass().getDefaultArkMethod();
        const defaultCfg = defaultMethod?.getCfg();
        const defaultLocal = defaultMethod?.getBody()?.getLocals().get(local.getName());
        const usedGlobal = method.getBody()?.getUsedGlobals()?.get(local.getName());
        const resolvedGlobal = usedGlobal instanceof GlobalRef
            ? usedGlobal.getRef()
            : usedGlobal;
        // Match the resolved global object, not the spelling alone. A method
        // local may legally shadow a module constant with the same name.
        if (!defaultCfg || defaultMethod === method ||
            !defaultLocal || resolvedGlobal !== defaultLocal) {
            return [];
        }

        const definitions: Value[] = [];
        for (const block of defaultCfg.getBlocks()) {
            for (const stmt of block.getStmts()) {
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const leftOp = stmt.getLeftOp();
                if (leftOp instanceof Local && leftOp.getName() === local.getName()) {
                    definitions.push(stmt.getRightOp());
                }
            }
        }
        return definitions;
    }

    private classifyValue(
        value: Value,
        alternatives: ReturnAlternatives,
        visited: Set<Value>
    ): void {
        if (visited.has(value)) {
            alternatives.nonNull = true;
            return;
        }
        visited.add(value);
        if (value instanceof NullConstant) {
            alternatives.null = true;
            return;
        }
        if (value instanceof UndefinedConstant) {
            alternatives.undefined = true;
            return;
        }
        if (value instanceof Local) {
            const declaringStmt = value.getDeclaringStmt();
            if (declaringStmt instanceof ArkAssignStmt) {
                this.classifyValue(declaringStmt.getRightOp(), alternatives, visited);
                return;
            }
        }
        // A non-literal project return is treated as the ordinary value branch.
        // Explicit null/undefined returns in the same method remain visible and
        // form MaybeNull/MaybeUndefined together with this branch.
        alternatives.nonNull = true;
    }

    private toKind(alternatives: ReturnAlternatives): NullnessKind | 'non-null' {
        if (alternatives.null && alternatives.undefined) return NullnessKind.MaybeNullish;
        if (alternatives.null) {
            return alternatives.nonNull ? NullnessKind.MaybeNull : NullnessKind.Null;
        }
        if (alternatives.undefined) {
            return alternatives.nonNull ? NullnessKind.MaybeUndefined : NullnessKind.Undefined;
        }
        return 'non-null';
    }
}
