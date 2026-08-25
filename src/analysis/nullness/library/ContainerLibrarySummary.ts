/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import fs from 'node:fs';
import path from 'node:path';
import { ArkInstanceInvokeExpr } from '../../../adapter/arkanalyzer';
import { Local } from '../../../adapter/arkanalyzer';
import { ArkInstanceFieldRef } from '../../../adapter/arkanalyzer';
import { ArkAssignStmt, ArkIfStmt, Stmt } from '../../../adapter/arkanalyzer';
import {
    AliasType,
    AnyType,
    ArrayType,
    ClassType,
    GenericType,
    NullType,
    Type,
    UndefinedType,
    UnionType,
    UnknownType,
    Value,
} from '../../../adapter/arkanalyzer';
import {
    NullnessAccessPath,
    NullnessFact,
    NullnessKind,
    NullnessOriginKind,
} from '../NullnessFact';
import { NullnessLibrarySummary } from './NullnessLibrarySummary';

export type ContainerOperation = 'read' | 'write' | 'delete' | 'transform' | 'predicate';

const CONTAINER_TYPES = new Set([
    'Array', 'Collection', 'Iterable', 'List', 'Map', 'Record', 'Set', 'ReadonlyArray',
]);
const READ_METHODS = new Set(['at', 'elementAt', 'find', 'first', 'get', 'peek', 'pop', 'shift']);
const WRITE_METHODS = new Set(['add', 'append', 'push', 'put', 'set', 'unshift']);
const DELETE_METHODS = new Set(['clear', 'delete', 'remove', 'pop', 'shift']);
const TRANSFORM_METHODS = new Set(['filter', 'flatMap', 'map', 'slice', 'splice', 'subarray']);
const PREDICATE_METHODS = new Set(['contains', 'has', 'includes', 'isEmpty']);

/** Generic, intentionally key-insensitive model for built-in container families. */
export class ContainerLibrarySummary implements NullnessLibrarySummary {
    readonly id = 'built-in-container';

    matches(callStmt: Stmt): boolean {
        const invoke = callStmt.getInvokeExpr();
        if (!(invoke instanceof ArkInstanceInvokeExpr)) {
            return false;
        }
        const operation = this.operation(invoke);
        if (!operation) {
            return false;
        }
        const methodClass = invoke.getMethodSignature().getDeclaringClassSignature();
        const receiverType = invoke.getBase().getType();
        if (receiverType instanceof ArrayType) {
            return true;
        }
        const receiverClass = receiverType instanceof ClassType
            ? receiverType.getClassSignature()
            : null;
        const methodFileName = methodClass.getDeclaringFileSignature().getFileName();
        if (!receiverClass && methodFileName === '%unk') {
            const receiverTypeName = receiverType.toString().split('<', 1)[0];
            if (CONTAINER_TYPES.has(receiverTypeName)) return true;
        }
        const classSignature = methodClass.getClassName() !== '' ? methodClass : receiverClass;
        if (!classSignature || !CONTAINER_TYPES.has(classSignature.getClassName())) {
            return false;
        }
        const fileSignature = classSignature.getDeclaringFileSignature();
        const fileName = fileSignature.getFileName();
        return fileName === '%unk' || fileSignature.toString().startsWith('@ES') ||
            fileName.startsWith('@built-in/') ||
            fileName.endsWith('.d.ts') || fileName.endsWith('.d.ets');
    }

    getCallToReturnFacts(callStmt: Stmt, inputFact: NullnessFact): Set<NullnessFact> {
        const result = new Set<NullnessFact>();
        const invoke = callStmt.getInvokeExpr();
        if (!(invoke instanceof ArkInstanceInvokeExpr)) {
            return result;
        }
        const operation = this.operation(invoke);
        if (!operation || !(callStmt instanceof ArkAssignStmt)) {
            return result;
        }

        const resultPath = NullnessAccessPath.fromValue(callStmt.getLeftOp());
        if (resultPath.isEmpty()) {
            return result;
        }
        if (inputFact.isZeroFact() && operation === 'read') {
            if (this.isProvenPresentRead(callStmt, invoke)) {
                return result;
            }
            result.add(NullnessFact.create(resultPath, NullnessKind.MaybeUndefined, {
                kind: NullnessOriginKind.LibraryModel,
                stmt: callStmt,
            }));
        } else if (!inputFact.isZeroFact() && operation === 'transform') {
            const argument = invoke.getArgs().find(arg =>
                NullnessAccessPath.fromValue(arg).equals(inputFact.accessPath)
            );
            if (argument) {
                result.add(inputFact.deriveWithNewAccessPath(resultPath, callStmt));
            }
        }
        return result;
    }

    suppressesLiteralReturns(callStmt: Stmt): boolean {
        const invoke = callStmt.getInvokeExpr();
        return invoke instanceof ArkInstanceInvokeExpr &&
            this.operation(invoke) === 'transform';
    }

    private isProvenPresentRead(
        callStmt: ArkAssignStmt,
        invoke: ArkInstanceInvokeExpr
    ): boolean {
        const methodName = invoke.getMethodSignature().getMethodSubSignature().getMethodName();
        if (methodName !== 'get') return false;
        return this.hasPriorSameKeySet(callStmt, invoke) ||
            this.hasDominatingSameKeyGuard(callStmt, invoke) ||
            this.isFullyPopulatedFieldMapIteration(callStmt, invoke);
    }

    /** Recognize `map.set(k, value); map.get(k)` in one straight-line block. */
    private hasPriorSameKeySet(
        callStmt: Stmt,
        getInvoke: ArkInstanceInvokeExpr
    ): boolean {
        const cfg = callStmt.getCfg();
        const block = cfg && [...cfg.getBlocks()].find(candidate =>
            candidate.getStmts().includes(callStmt));
        if (!block) return false;
        const statements = block.getStmts();
        const targetIndex = statements.indexOf(callStmt);
        let present = false;
        for (let index = 0; index < targetIndex; index++) {
            const invoke = statements[index].getInvokeExpr();
            if (!(invoke instanceof ArkInstanceInvokeExpr) ||
                !this.sameValue(invoke.getBase(), getInvoke.getBase())) {
                continue;
            }
            const name = invoke.getMethodSignature().getMethodSubSignature().getMethodName();
            if (name === 'clear' || name === 'delete' &&
                this.sameValue(invoke.getArgs()[0], getInvoke.getArgs()[0])) {
                present = false;
            } else if (name === 'set' &&
                this.sameValue(invoke.getArgs()[0], getInvoke.getArgs()[0])) {
                present = true;
            }
        }
        return present;
    }

    /** Recognize the true edge of `if (map.has(k))`. */
    private hasDominatingSameKeyGuard(
        callStmt: Stmt,
        getInvoke: ArkInstanceInvokeExpr
    ): boolean {
        const cfg = callStmt.getCfg();
        if (!cfg) return false;
        const blocks = [...cfg.getBlocks()];
        const target = blocks.find(block => block.getStmts().includes(callStmt));
        if (!target) return false;
        for (const block of blocks) {
            const tail = block.getTail();
            if (!(tail instanceof ArkIfStmt)) continue;
            const source = tail.getOriginalText?.() ?? '';
            if (/\bif\s*\(\s*!/.test(source)) continue;
            const hasInvoke = this.findInvoke(
                tail.getConditionExpr(),
                'has',
                new Set()
            );
            if (!hasInvoke ||
                !this.sameValue(hasInvoke.getBase(), getInvoke.getBase()) ||
                !this.sameValue(hasInvoke.getArgs()[0], getInvoke.getArgs()[0])) {
                continue;
            }
            const successors = block.getSuccessors();
            if (successors.length !== 2 || successors[0] === successors[1]) continue;
            if (this.blockReaches(successors[0], target) &&
                !this.blockReaches(successors[1], target)) {
                return true;
            }
        }
        return false;
    }

    /**
     * ArkUI lowers a `ForEach(fieldValues, key => fieldMap.get(key))` callback
     * into a separate method.  Recover the finite source-level invariant when
     * every value in the field array is inserted and the map is never cleared.
     */
    private isFullyPopulatedFieldMapIteration(
        callStmt: Stmt,
        invoke: ArkInstanceInvokeExpr
    ): boolean {
        const receiver = this.resolveValue(invoke.getBase(), new Set());
        if (!(receiver instanceof ArkInstanceFieldRef)) return false;
        const mapName = receiver.getFieldSignature().getFieldName();
        const key = invoke.getArgs()[0];
        const keyName = key instanceof Local
            ? key.getName()
            : null;
        const declaringClass = callStmt.getCfg()?.getDeclaringMethod().getDeclaringArkClass();
        const code = declaringClass?.getCode();
        if (!keyName || !code) return false;

        const escapedKey = escapePattern(keyName);
        const iteration = new RegExp(
            `ForEach\\s*\\(\\s*this\\.([A-Za-z_$][\\w$]*)\\s*,\\s*` +
            `\\(\\s*${escapedKey}\\b`
        ).exec(code);
        if (!iteration) return false;
        const listName = iteration[1];
        const listInitializer = new RegExp(
            `\\b${escapePattern(listName)}\\b[^=;]*=\\s*\\[([^\\]]+)\\]`
        ).exec(code)?.[1];
        if (!listInitializer) return false;
        const values = [...listInitializer.matchAll(
            /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+/g
        )].map(match => match[0]);
        if (values.length === 0) return false;
        const setValues = new Set(
            [...code.matchAll(new RegExp(
                `this\\.${escapePattern(mapName)}\\.set\\s*\\(\\s*` +
                `([^,\\n]+)`,
                'g'
            ))].map(match => match[1].replace(/\s+/g, ''))
        );
        if (!values.every(value => setValues.has(value.replace(/\s+/g, '')))) {
            return false;
        }
        return !new RegExp(
            `this\\.${escapePattern(mapName)}\\.(?:clear|delete)\\s*\\(`
        ).test(code);
    }

    private findInvoke(
        value: Value,
        methodName: string,
        visited: Set<Value>
    ): ArkInstanceInvokeExpr | null {
        if (visited.has(value)) return null;
        visited.add(value);
        if (value instanceof ArkInstanceInvokeExpr &&
            value.getMethodSignature().getMethodSubSignature().getMethodName() === methodName) {
            return value;
        }
        if (value instanceof Local) {
            const declaringInvoke = value.getDeclaringStmt()?.getInvokeExpr();
            if (declaringInvoke instanceof ArkInstanceInvokeExpr &&
                declaringInvoke.getMethodSignature().getMethodSubSignature().getMethodName() === methodName) {
                return declaringInvoke;
            }
        }
        for (const used of value.getUses()) {
            const found = this.findInvoke(used, methodName, visited);
            if (found) return found;
        }
        return null;
    }

    private sameValue(left: Value | undefined, right: Value | undefined): boolean {
        if (!left || !right) return false;
        if (left === right) return true;
        return this.resolveValue(left, new Set()).toString() ===
            this.resolveValue(right, new Set()).toString();
    }

    private resolveValue(value: Value, visited: Set<Value>): Value {
        if (!(value instanceof Local) || visited.has(value)) return value;
        visited.add(value);
        const declaringStmt = value.getDeclaringStmt();
        if (!(declaringStmt instanceof ArkAssignStmt) || declaringStmt.getInvokeExpr()) {
            return value;
        }
        return this.resolveValue(declaringStmt.getRightOp(), visited);
    }

    private blockReaches(
        start: { getSuccessors(): unknown[] },
        target: unknown
    ): boolean {
        const workList: Array<{ getSuccessors(): unknown[] }> = [start];
        const visited = new Set<unknown>();
        while (workList.length > 0) {
            const current = workList.pop()!;
            if (current === target) return true;
            if (visited.has(current)) continue;
            visited.add(current);
            for (const successor of current.getSuccessors()) {
                workList.push(successor as { getSuccessors(): unknown[] });
            }
        }
        return false;
    }

    private operation(invoke: ArkInstanceInvokeExpr): ContainerOperation | null {
        const methodName = invoke.getMethodSignature().getMethodSubSignature().getMethodName();
        if (READ_METHODS.has(methodName)) return 'read';
        if (WRITE_METHODS.has(methodName)) return 'write';
        if (DELETE_METHODS.has(methodName)) return 'delete';
        if (TRANSFORM_METHODS.has(methodName)) return 'transform';
        if (PREDICATE_METHODS.has(methodName)) return 'predicate';
        return null;
    }
}

function escapePattern(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type ReturnNullness = 'non-null' | NullnessKind;
type InferredReturnNullness = ReturnNullness | 'unknown';

interface ReturnContract {
    kind: ReturnNullness;
    unresolved: boolean;
}

interface JsonReturnSummary {
    className: string;
    methodName: string;
    returnNullness: ReturnNullness;
}

interface JsonSummaryFile {
    schemaVersion: number;
    methods: JsonReturnSummary[];
}

interface TypeAlternatives {
    null: boolean;
    undefined: boolean;
    nonNull: boolean;
    unknown: boolean;
}

const JSON_RETURN_SUMMARIES = loadJsonReturnSummaries();

// ECMAScript operations whose normal completion always produces a non-nullish
// value.  Methods such as RegExp.exec/match, Map.get and JSON.parse are omitted
// because null or undefined is a valid result for them.
const NON_NULL_STRING_METHODS = new Set([
    'charAt', 'concat', 'normalize', 'padEnd', 'padStart', 'repeat',
    'replace', 'replaceAll', 'slice', 'split', 'substr', 'substring',
    'toLocaleLowerCase', 'toLocaleUpperCase', 'toLowerCase', 'toUpperCase',
    'trim', 'trimEnd', 'trimLeft', 'trimRight', 'trimStart', 'valueOf',
]);
const NON_NULL_ARRAY_METHODS = new Set([
    'concat', 'filter', 'flat', 'flatMap', 'map', 'reverse', 'slice', 'sort', 'splice',
]);
const NON_NULL_GLOBAL_METHODS = new Set([
    'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent',
    'parseFloat', 'parseInt',
]);
const NON_NULL_ECMASCRIPT_METHODS = new Set([
    ...NON_NULL_STRING_METHODS,
    ...NON_NULL_ARRAY_METHODS,
    ...NON_NULL_GLOBAL_METHODS,
    'round',
]);

/**
 * Conservative return model for SDK/third-party methods.
 *
 * Prefer the return type already resolved from the loaded SDK. The small JSON
 * file is only an escape hatch for missing/incomplete declarations; unknown
 * return types retain the old conservative MaybeNullish behavior.
 *
 * TODO: Match JSON overrides by complete method signature when overloads need
 * different nullness contracts.
 * TODO: Inspect nullable Callback/AsyncCallback parameter types and seed their
 * callback-entry parameters once callback-edge resolution exposes a reliable
 * call-site-to-callback mapping. Merely reading the parameter type is not
 * enough to create the required interprocedural edge.
 * TODO: Model nullable framework-injected lifecycle parameters separately at
 * synthetic entry construction rather than treating them as return values.
 */
export class SdkReturnTypeSummary implements NullnessLibrarySummary {
    readonly id = 'sdk-return-type';

    matches(callStmt: Stmt): boolean {
        const invoke = callStmt.getInvokeExpr();
        if (!invoke) return false;
        const methodName = invoke.getMethodSignature().getMethodSubSignature().getMethodName();
        if (methodName === 'constructor' || methodName.startsWith('%')) return false;
        const fileSignature = invoke.getMethodSignature()
            .getDeclaringClassSignature().getDeclaringFileSignature();
        const fileName = fileSignature.getFileName();
        return fileName === '%unk' || fileSignature.toString().startsWith('@ES') ||
            fileName.startsWith('@built-in/') ||
            fileName.endsWith('.d.ts') || fileName.endsWith('.d.ets');
    }

    getCallToReturnFacts(callStmt: Stmt, inputFact: NullnessFact): Set<NullnessFact> {
        if (!inputFact.isZeroFact() || !(callStmt instanceof ArkAssignStmt)) {
            return new Set();
        }
        const resultPath = NullnessAccessPath.fromValue(callStmt.getLeftOp());
        if (resultPath.isEmpty()) return new Set();
        const contract = this.getReturnContract(callStmt);
        if (contract.kind === 'non-null') {
            return new Set();
        }
        return new Set([NullnessFact.create(resultPath, contract.kind, {
            kind: contract.unresolved
                ? NullnessOriginKind.UnresolvedReturn
                : NullnessOriginKind.LibraryModel,
            stmt: callStmt,
            description: contract.unresolved
                ? 'unresolved SDK/third-party return contract'
                : 'nullable SDK/library return contract',
        })]);
    }

    private getReturnContract(callStmt: Stmt): ReturnContract {
        const invoke = callStmt.getInvokeExpr()!;
        const method = invoke.getMethodSignature();
        const declaringClass = method.getDeclaringClassSignature();
        const className = declaringClass.getClassName();
        const declaringFile = declaringClass.getDeclaringFileSignature().getFileName();
        const methodName = method.getMethodSubSignature().getMethodName();
        if (methodName === 'getHostContext' &&
            invoke instanceof ArkInstanceInvokeExpr &&
            this.isDirectComponentUiContext(invoke)) {
            return { kind: 'non-null', unresolved: false };
        }
        if (className === 'RegExp' && methodName === 'exec') {
            return { kind: NullnessKind.MaybeNull, unresolved: false };
        }
        const inferred = inferReturnNullness(invoke.getType());
        if (inferred !== 'unknown') {
            return { kind: inferred, unresolved: false };
        }
        if (isKnownNonNullBuiltin(declaringFile, className, methodName)) {
            return { kind: 'non-null', unresolved: false };
        }
        const override = JSON_RETURN_SUMMARIES.get(`${className}.${methodName}`);
        if (override) {
            return { kind: override, unresolved: false };
        }
        return { kind: NullnessKind.MaybeNullish, unresolved: true };
    }

    /** `this.getUIContext().getHostContext()` inside a component has an attached host. */
    private isDirectComponentUiContext(invoke: ArkInstanceInvokeExpr): boolean {
        const base = invoke.getBase();
        if (!(base instanceof Local)) return false;
        const declaringStmt = base.getDeclaringStmt();
        const baseInvoke = declaringStmt?.getInvokeExpr();
        return baseInvoke?.getMethodSignature().getMethodSubSignature().getMethodName() ===
            'getUIContext';
    }
}

function isKnownNonNullBuiltin(
    declaringFile: string,
    className: string,
    methodName: string
): boolean {
    if (declaringFile.startsWith('@ES') || declaringFile.startsWith('@built-in/') ||
        /(?:^|\/)lib\.es[^/]*\.d\.ts$/.test(declaringFile)) {
        return NON_NULL_ECMASCRIPT_METHODS.has(methodName);
    }
    if (className === 'String') return NON_NULL_STRING_METHODS.has(methodName);
    if (className === 'Array' || className === 'ReadonlyArray') {
        return NON_NULL_ARRAY_METHODS.has(methodName);
    }
    if (className === 'Math') return methodName === 'round';
    if (className === '%dflt') return NON_NULL_GLOBAL_METHODS.has(methodName);
    // ArkAnalyzer sometimes loses the declaring String signature after a value
    // has flowed through an untyped local. Keep this narrow fallback limited to
    // standard String operations instead of every SDK method with the same name.
    return declaringFile === '%unk' && NON_NULL_STRING_METHODS.has(methodName);
}

function inferReturnNullness(type: Type): InferredReturnNullness {
    const alternatives: TypeAlternatives = {
        null: false,
        undefined: false,
        nonNull: false,
        unknown: false,
    };
    collectTypeAlternatives(type, alternatives, new Set<Type>());
    if (alternatives.unknown) return 'unknown';
    if (alternatives.null && alternatives.undefined) return NullnessKind.MaybeNullish;
    if (alternatives.null) {
        return alternatives.nonNull ? NullnessKind.MaybeNull : NullnessKind.Null;
    }
    if (alternatives.undefined) {
        return alternatives.nonNull ? NullnessKind.MaybeUndefined : NullnessKind.Undefined;
    }
    return 'non-null';
}

function collectTypeAlternatives(
    type: Type,
    alternatives: TypeAlternatives,
    visited: Set<Type>
): void {
    if (visited.has(type)) return;
    visited.add(type);

    if (type instanceof AliasType) {
        collectTypeAlternatives(type.getOriginalType(), alternatives, visited);
    } else if (type instanceof UnionType) {
        for (const member of type.getTypes()) {
            collectTypeAlternatives(member, alternatives, visited);
        }
    } else if (type instanceof NullType) {
        alternatives.null = true;
    } else if (type instanceof UndefinedType) {
        alternatives.undefined = true;
    } else if (type instanceof UnknownType || type instanceof AnyType || type instanceof GenericType) {
        alternatives.unknown = true;
    } else {
        alternatives.nonNull = true;
    }
}

function loadJsonReturnSummaries(): Map<string, ReturnNullness> {
    const summaries = new Map<string, ReturnNullness>();
    const configPath = path.join(__dirname, 'sdk-nullness-summary.json');
    if (!fs.existsSync(configPath)) return summaries;
    try {
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as JsonSummaryFile;
        if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.methods)) return summaries;
        for (const method of parsed.methods) {
            if (method.className && method.methodName && isReturnNullness(method.returnNullness)) {
                summaries.set(`${method.className}.${method.methodName}`, method.returnNullness);
            }
        }
    } catch {
        // Invalid optional overrides must not prevent the analysis from starting.
    }
    return summaries;
}

function isReturnNullness(value: unknown): value is ReturnNullness {
    return value === 'non-null' || Object.values(NullnessKind).includes(value as NullnessKind);
}
