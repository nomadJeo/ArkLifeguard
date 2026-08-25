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

import {
    BooleanConstant,
    NullConstant,
    NumberConstant,
    StringConstant,
    UndefinedConstant,
} from '../../adapter/arkanalyzer';
import {
    ArkAwaitExpr,
    ArkConditionExpr,
    ArkInstanceOfExpr,
    ArkInstanceInvokeExpr,
    ArkNormalBinopExpr,
    ArkUnopExpr,
    NormalBinaryOperator,
    RelationalBinaryOperator,
    UnaryOperator,
} from '../../adapter/arkanalyzer';
import { Local } from '../../adapter/arkanalyzer';
import {
    ArkArrayRef,
    ArkInstanceFieldRef,
    ArkParameterRef,
    ArkThisRef,
    ClosureFieldRef,
} from '../../adapter/arkanalyzer';
import { ArkAssignStmt, ArkIfStmt, ArkReturnStmt, Stmt } from '../../adapter/arkanalyzer';
import { DataflowProblem, FlowFunction } from '../../ifds';
import { ArkClass, ArkMethod } from '../../adapter/arkanalyzer';
import { CONSTRUCTOR_NAME, ModifierType } from '../../adapter/arkanalyzer';
import {
    AliasType,
    FunctionType,
    LexicalEnvType,
    NullType,
    Type,
    UndefinedType,
    UnionType,
} from '../../adapter/arkanalyzer';
import { Value } from '../../adapter/arkanalyzer';
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
} from './NullnessFact';
import { NullnessLibraryRegistry } from './library/NullnessLibraryRegistry';
import { haveSameCallableIdentity, tryRenderArkType } from './ArkAnalyzerCompatibility';

export interface NullnessAnalysisConfig {
    maxAccessPathLength?: number;
    /** Maximum number of fact-transforming propagation steps; mirrors taint analysis bounds. */
    maxPropagationDepth?: number;
    /** Include low-confidence diagnostics based only on unresolved return types. */
    reportUnresolvedReturns?: boolean;
    /** Join fact kinds and access paths inside recursive call-graph SCCs. */
    recursiveSccWidening?: boolean;
    /** Access-path depth retained inside a recursive SCC before a wildcard suffix. */
    recursiveSccAccessPathLength?: number;
    /** Method-count threshold for conservative whole-project path widening. */
    largeProjectWideningThreshold?: number;
    /** Access-path depth retained when the large-project threshold is exceeded. */
    largeProjectAccessPathLength?: number;
}

export interface NullDereferenceDiagnostic {
    kind: 'null-dereference';
    nullness: NullnessKind;
    accessPath: NullnessAccessPath;
    sourceStmt: Stmt;
    dereferenceStmt: Stmt;
    sourceLocation: NullnessSourceLocation;
    dereferenceLocation: NullnessSourceLocation;
    description: string;
    confidence: 'high' | 'low';
}

export interface NullnessSourceLocation {
    filePath: string;
    line: number;
    col: number;
}

/**
 * IFDS problem for nullness analysis.
 *
 * Nullish facts are propagated through assignments, arguments, receivers and return values.
 * Reading a field, invoking a method or indexing an array through a tracked access path emits
 * a source-linked diagnostic.
 */
export class NullnessProblem extends DataflowProblem<NullnessFact> {
    private readonly zeroFact = NullnessFact.getZeroFact();
    private readonly config: Required<NullnessAnalysisConfig>;
    private readonly nullDereferences: NullDereferenceDiagnostic[] = [];
    private readonly dereferenceSyntaxCache = new WeakMap<Stmt, DereferenceSyntax>();
    private readonly staticNullFacts: NullnessFact[] = [];
    private readonly staticDereferenceSites: Array<{ path: NullnessAccessPath; stmt: Stmt }> = [];
    private readonly relationalGuardCache = new WeakMap<ArkMethod, Map<string, boolean>>();

    constructor(
        private readonly entryPoint: Stmt,
        private readonly entryMethod: ArkMethod,
        config: NullnessAnalysisConfig = {},
        private readonly libraryRegistry: NullnessLibraryRegistry = NullnessLibraryRegistry.createDefault()
    ) {
        super();
        this.config = {
            maxAccessPathLength: config.maxAccessPathLength ?? 5,
            maxPropagationDepth: config.maxPropagationDepth ?? 100,
            reportUnresolvedReturns: config.reportUnresolvedReturns ?? false,
            recursiveSccWidening: config.recursiveSccWidening ?? true,
            recursiveSccAccessPathLength: config.recursiveSccAccessPathLength ?? 2,
            largeProjectWideningThreshold: config.largeProjectWideningThreshold ?? 5000,
            largeProjectAccessPathLength: config.largeProjectAccessPathLength ?? 2,
        };
    }

    getNormalFlowFunction(srcStmt: Stmt, tgtStmt: Stmt): FlowFunction<NullnessFact> {
        const problem = this;
        return new (class implements FlowFunction<NullnessFact> {
            getDataFacts(fact: NullnessFact): Set<NullnessFact> {
                const result = new Set<NullnessFact>();
                if (fact.isZeroFact()) {
                    problem.checkTypedNonNullArguments(srcStmt);
                    problem.checkLateNullGuard(srcStmt);
                    problem.recordStaticDereferenceSite(srcStmt);
                    result.add(fact);
                    const generated = problem.createNullishLiteralFact(srcStmt);
                    if (generated) {
                        result.add(generated);
                    }
                    const nullableFieldRead = problem.createKnownNullableFieldReadFact(srcStmt);
                    if (nullableFieldRead) {
                        result.add(nullableFieldRead);
                    }
                    for (const summaryFact of problem.libraryRegistry
                        .getCallToReturnFacts(srcStmt, fact)) {
                        result.add(summaryFact);
                    }
                    return result;
                }

                const narrowedFact = problem.narrowFactOnBranch(srcStmt, tgtStmt, fact);
                if (!narrowedFact) {
                    return result;
                }
                fact = narrowedFact;


                problem.checkDirectDereference(srcStmt, fact);

                if (srcStmt instanceof ArkAssignStmt) {
                    const propagated = problem.propagateAssignment(srcStmt, fact);
                    for (const derivedFact of propagated) {
                        result.add(derivedFact);
                    }
                    if (!problem.definesAccessPath(srcStmt, fact.accessPath)) {
                        result.add(fact);
                    }
                    return result;
                }

                result.add(fact);
                return result;
            }
        })();
    }

    getCallFlowFunction(srcStmt: Stmt, method: ArkMethod): FlowFunction<NullnessFact> {
        const problem = this;
        return {
            getDataFacts(fact: NullnessFact): Set<NullnessFact> {
                const result = new Set<NullnessFact>();
                if (fact.isZeroFact()) {
                    result.add(fact);
                }
                // Static fields are global facts. They do not need parameter or
                // receiver rebasing when a caller enters another method.
                if (fact.accessPath.isStaticFieldRef()) {
                    result.add(fact);
                }
                const invokeExpr = srcStmt.getInvokeExpr();
                if (!invokeExpr) {
                    return result;
                }

                const args = invokeExpr.getArgs();
                if (fact.isZeroFact()) {
                    for (let index = 0; index < args.length; index++) {
                        const argument = args[index];
                        const kind = argument instanceof NullConstant
                            ? NullnessKind.Null
                            : argument instanceof UndefinedConstant
                                ? NullnessKind.Undefined
                                : null;
                        if (!kind) continue;
                        const parameterLocal = problem.getParameterLocal(method, index);
                        if (!parameterLocal) continue;
                        result.add(NullnessFact.create(
                            NullnessAccessPath.fromValue(parameterLocal),
                            kind,
                            {
                                kind: kind === NullnessKind.Null
                                    ? NullnessOriginKind.NullLiteral
                                    : NullnessOriginKind.UndefinedLiteral,
                                stmt: srcStmt,
                                description: `${kind} literal passed to parameter ${index}`,
                            }
                        ));
                    }
                    return result;
                }

                if (invokeExpr instanceof ArkInstanceInvokeExpr) {
                    const receiverPath = NullnessAccessPath.fromValue(invokeExpr.getBase());
                    if (receiverPath.isPrefixOf(fact.accessPath)) {
                        const thisLocal = problem.getThisLocal(method);
                        const remainingFields = fact.accessPath.fields.slice(
                            receiverPath.fields.length
                        );
                        // Entering an instance method already proves that its
                        // receiver is non-null on the normal call edge.  Only
                        // facts below the receiver (receiver.field) belong in
                        // the callee; mapping an exact nullable receiver to the
                        // callee's `this` creates impossible executions for
                        // optional calls such as `handler?.update()`.
                        if (thisLocal && remainingFields.length > 0) {
                            result.add(fact.deriveWithNewAccessPath(
                                new NullnessAccessPath(
                                    thisLocal,
                                    thisLocal.getType(),
                                    remainingFields
                                ),
                                srcStmt
                            ));
                        }
                    }
                }

                for (const asyncFact of problem.mapAsyncBoundaryFactToCallee(
                    srcStmt,
                    method,
                    fact
                )) {
                    result.add(asyncFact);
                }

                for (const closureFact of problem.mapCapturedFactToCallee(
                    args,
                    method,
                    fact,
                    srcStmt
                )) {
                    result.add(closureFact);
                }

                for (let index = 0; index < args.length; index++) {
                    const argumentPath = NullnessAccessPath.fromValue(args[index]);
                    if (argumentPath.isEmpty() ||
                        !argumentPath.isPrefixOf(fact.accessPath)) {
                        continue;
                    }

                    const parameterLocal = problem.getParameterLocal(method, index);
                    if (parameterLocal) {
                        const remainingFields = fact.accessPath.fields.slice(
                            argumentPath.fields.length
                        );
                        result.add(fact.deriveWithNewAccessPath(
                            new NullnessAccessPath(
                                parameterLocal,
                                parameterLocal.getType(),
                                remainingFields
                            ),
                            srcStmt
                        ));
                    }
                }

                return result;
            },
        };
    }

    getExitToReturnFlowFunction(srcStmt: Stmt, _tgtStmt: Stmt, callStmt: Stmt): FlowFunction<NullnessFact> {
        const problem = this;
        return {
            getDataFacts(fact: NullnessFact): Set<NullnessFact> {
                const result = new Set<NullnessFact>();
                const callTargetPath = callStmt instanceof ArkAssignStmt
                    ? NullnessAccessPath.fromValue(callStmt.getLeftOp())
                    : NullnessAccessPath.getEmptyAccessPath();
                const returnTargetPath = problem.isPromiseContinuation(callStmt) &&
                    !callTargetPath.isEmpty()
                    ? callTargetPath.appendPromisePayload()
                    : callTargetPath;

                if (fact.isZeroFact()) {
                    result.add(fact);
                    // A call-site summary joins all normal return alternatives
                    // (and may select a non-null overload).  Do not re-introduce
                    // one individual `return null` as a definite fact on the
                    // exit edge after that joined contract has been applied on
                    // the call-to-return edge.
                    const returnedKind = !problem.libraryRegistry.shouldSuppressLiteralReturn(
                        callStmt,
                        fact
                    ) &&
                        srcStmt instanceof ArkReturnStmt
                        ? problem.getLiteralNullnessKind(srcStmt.getOp())
                        : null;
                    if (returnedKind && problem.isTrackableAccessPath(returnTargetPath)) {
                        result.add(NullnessFact.create(
                            returnTargetPath,
                            returnedKind,
                            {
                                kind: returnedKind === NullnessKind.Null
                                    ? NullnessOriginKind.NullLiteral
                                    : NullnessOriginKind.UndefinedLiteral,
                                stmt: srcStmt,
                                description: `returned the ${returnedKind} literal`,
                            }
                        ));
                    }
                    return result;
                }

                const invokeExpr = callStmt.getInvokeExpr();
                if (invokeExpr instanceof ArkInstanceInvokeExpr &&
                    fact.accessPath.base?.getName() === 'this') {
                    result.add(fact.deriveWithReplacedBase(invokeExpr.getBase(), callStmt));
                }

                // Static fields are heap/global state rather than values rooted at
                // the callee's `this`.  A callback may update a static field and a
                // later lifecycle method may read it through another receiver (or
                // without a receiver at all).  Preserve the canonical static-field
                // access path across the callee exit so the caller's subsequent CFG
                // nodes can observe the update.
                if (fact.accessPath.isStaticFieldRef()) {
                    result.add(fact);
                }

                if (srcStmt instanceof ArkReturnStmt &&
                    !problem.libraryRegistry.shouldSuppressLiteralReturn(
                        callStmt,
                        problem.zeroFact
                    ) &&
                    problem.isTrackableAccessPath(returnTargetPath)) {
                    const returnedPath = NullnessAccessPath.fromValue(srcStmt.getOp());
                    if (!returnedPath.isEmpty() && returnedPath.isPrefixOf(fact.accessPath)) {
                        const remainingFields = fact.accessPath.fields.slice(returnedPath.fields.length);
                        const mappedPath = new NullnessAccessPath(
                            returnTargetPath.base,
                            returnTargetPath.baseType,
                            [...returnTargetPath.fields, ...remainingFields],
                            returnTargetPath.isStatic
                        );
                        if (problem.isTrackableAccessPath(mappedPath)) {
                            result.add(fact.deriveWithNewAccessPath(mappedPath, callStmt));
                        }
                    }
                }

                return result;
            },
        };
    }

    getCallToReturnFlowFunction(
        srcStmt: Stmt,
        _tgtStmt: Stmt,
        callees?: ReadonlySet<ArkMethod>
    ): FlowFunction<NullnessFact> {
        const problem = this;
        return {
            getDataFacts(fact: NullnessFact): Set<NullnessFact> {
                if (fact.isZeroFact()) {
                    problem.checkTypedNonNullArguments(srcStmt);
                    problem.checkLateNullGuard(srcStmt);
                    problem.recordStaticDereferenceSite(srcStmt);
                }
                const result = problem.libraryRegistry.getCallToReturnFacts(srcStmt, fact);
                if (!fact.isZeroFact()) {
                    problem.checkDirectDereference(srcStmt, fact);
                    if (srcStmt instanceof ArkAssignStmt &&
                        problem.definesAccessPath(srcStmt, fact.accessPath)) {
                        return result;
                    }
                    if (problem.shouldRouteReceiverFieldThroughCallee(
                        srcStmt,
                        fact,
                        callees
                    )) {
                        return result;
                    }
                }
                result.add(fact);
                return result;
            },
        };
    }

    createZeroValue(): NullnessFact {
        return this.zeroFact;
    }

    getEntryPoint(): Stmt {
        return this.entryPoint;
    }

    getEntryMethod(): ArkMethod {
        return this.entryMethod;
    }

    factEqual(left: NullnessFact, right: NullnessFact): boolean {
        return left.equals(right);
    }

    getConfig(): Readonly<Required<NullnessAnalysisConfig>> {
        return this.config;
    }

    getNullDereferences(): readonly NullDereferenceDiagnostic[] {
        return this.nullDereferences;
    }

    private createNullishLiteralFact(stmt: Stmt): NullnessFact | null {
        if (!(stmt instanceof ArkAssignStmt)) {
            return null;
        }

        const rightOp = stmt.getRightOp();
        const kind = this.getLiteralNullnessKind(rightOp);
        if (!kind) {
            return null;
        }

        const accessPath = NullnessAccessPath.fromValue(stmt.getLeftOp());
        if (!this.isTrackableAccessPath(accessPath)) {
            return null;
        }
        // A required ArkUI component property is supplied by the framework
        // before build() runs. Its source-level `= undefined` is only a
        // declaration placeholder, not a reachable component-entry value.
        if (this.isRequiredComponentField(stmt, accessPath)) {
            return null;
        }

        const fact = NullnessFact.create(accessPath, kind, {
            kind: kind === NullnessKind.Null
                ? NullnessOriginKind.NullLiteral
                : NullnessOriginKind.UndefinedLiteral,
            stmt,
            description: `assigned the ${kind} literal`,
        });
        this.recordStaticNullFact(fact);
        return fact;
    }

    /** Seed nullable reads whose platform contract is not represented as a call summary. */
    private createKnownNullableFieldReadFact(stmt: Stmt): NullnessFact | null {
        if (!(stmt instanceof ArkAssignStmt)) return null;
        const rightOp = stmt.getRightOp();
        if (!(rightOp instanceof ArkInstanceFieldRef)) return null;

        const signature = rightOp.getFieldSignature();
        if (signature.getFieldName() !== 'stack' || signature.getBaseName() !== 'Error') {
            return null;
        }
        const accessPath = NullnessAccessPath.fromValue(stmt.getLeftOp());
        if (!this.isTrackableAccessPath(accessPath)) return null;

        return NullnessFact.create(accessPath, NullnessKind.MaybeUndefined, {
            kind: NullnessOriginKind.LibraryModel,
            stmt,
            description: 'nullable Error.stack field read',
        });
    }

    private getLiteralNullnessKind(value: unknown): NullnessKind | null {
        return value instanceof NullConstant
            ? NullnessKind.Null
            : value instanceof UndefinedConstant
                ? NullnessKind.Undefined
                : null;
    }

    private isTrackableAccessPath(accessPath: NullnessAccessPath): boolean {
        // Overlong paths are conservatively folded to a wildcard suffix by the
        // solver. Dropping them here would make the depth bound under-approximate.
        return !accessPath.isEmpty() && !accessPath.isZero();
    }

    private shouldRouteReceiverFieldThroughCallee(
        callStmt: Stmt,
        fact: NullnessFact,
        callees?: ReadonlySet<ArkMethod>
    ): boolean {
        if (!callees || callees.size === 0 ||
            [...callees].some(callee => !callee.getCfg()) ||
            fact.accessPath.fields.length === 0) {
            return false;
        }
        const invokeExpr = callStmt.getInvokeExpr();
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) {
            return false;
        }
        const receiverPath = NullnessAccessPath.fromValue(invokeExpr.getBase());
        return !receiverPath.isEmpty() && receiverPath.isPrefixOf(fact.accessPath);
    }

    /**
     * Maps a caller fact captured by a lexical-environment argument to the
     * corresponding ClosureFieldRef at the callee entry.
     *
     * ArkIR lowers a nested call as `inner(%closuresN)` and starts the nested
     * method with `captured = %closuresN.captured`.  Seeding the field fact lets
     * the ordinary assignment transfer create the callee-local fact, including
     * for another nested closure level.
     */
    private mapCapturedFactToCallee(
        args: readonly Value[],
        callee: ArkMethod,
        fact: NullnessFact,
        callStmt: Stmt
    ): Set<NullnessFact> {
        const result = new Set<NullnessFact>();
        for (const argument of args) {
            const argumentType = argument.getType();
            if (!(argumentType instanceof LexicalEnvType)) {
                continue;
            }

            for (const capturedLocal of argumentType.getClosures()) {
                const callerPath = NullnessAccessPath.fromValue(capturedLocal);
                if (callerPath.isEmpty() || !callerPath.isPrefixOf(fact.accessPath)) {
                    continue;
                }

                const calleeClosureRef = this.findCapturedClosureRef(
                    callee,
                    capturedLocal.getName()
                );
                if (!calleeClosureRef) {
                    continue;
                }
                const closurePath = NullnessAccessPath.fromValue(calleeClosureRef);
                const remainingFields = fact.accessPath.fields.slice(callerPath.fields.length);
                const mappedPath = new NullnessAccessPath(
                    closurePath.base,
                    closurePath.baseType,
                    [...closurePath.fields, ...remainingFields],
                    closurePath.isStatic
                );
                if (this.isTrackableAccessPath(mappedPath)) {
                    result.add(fact.deriveWithNewAccessPath(mappedPath, callStmt));
                }
            }
        }
        return result;
    }

    private mapAsyncBoundaryFactToCallee(
        callStmt: Stmt,
        callee: ArkMethod,
        fact: NullnessFact
    ): Set<NullnessFact> {
        const result = new Set<NullnessFact>();
        const invoke = callStmt.getInvokeExpr();
        if (!invoke || !this.isExecutableAsyncBoundary(callStmt) ||
            !this.isFunctionArgumentCallee(invoke.getArgs(), callee)) {
            return result;
        }

        // Arrow callbacks retain the lexical receiver. ArkIR gives the callback
        // a distinct `this` Local, so map fields rooted at the caller's `this`.
        if (fact.accessPath.base?.getName() === 'this') {
            const calleeThis = this.getThisLocal(callee);
            if (calleeThis) {
                result.add(fact.deriveWithReplacedBase(calleeThis, callStmt));
            }
        }

        const capturedName = fact.accessPath.base?.getName();
        if (capturedName) {
            const closureRef = this.findCapturedClosureRef(callee, capturedName);
            if (closureRef) {
                const closurePath = NullnessAccessPath.fromValue(closureRef);
                const mappedPath = new NullnessAccessPath(
                    closurePath.base,
                    closurePath.baseType,
                    [...closurePath.fields, ...fact.accessPath.fields],
                    closurePath.isStatic
                );
                if (this.isTrackableAccessPath(mappedPath)) {
                    result.add(fact.deriveWithNewAccessPath(mappedPath, callStmt));
                }
            }
        }

        if (!this.isPromiseThen(callStmt)) {
            return result;
        }
        const instanceInvoke = invoke instanceof ArkInstanceInvokeExpr ? invoke : null;
        if (!instanceInvoke) return result;
        const receiverPayload = NullnessAccessPath.fromValue(
            instanceInvoke.getBase()
        ).appendPromisePayload();
        if (!receiverPayload.isPrefixOf(fact.accessPath)) {
            return result;
        }
        const parameter = this.getParameterLocal(callee, 0);
        if (!parameter) return result;
        const remainingFields = fact.accessPath.fields.slice(receiverPayload.fields.length);
        result.add(fact.deriveWithNewAccessPath(new NullnessAccessPath(
            parameter,
            parameter.getType(),
            remainingFields
        ), callStmt));
        return result;
    }

    private isFunctionArgumentCallee(args: readonly Value[], callee: ArkMethod): boolean {
        const signature = callee.getSignature();
        return args.some(argument => {
            const type = argument.getType();
            return type instanceof FunctionType &&
                haveSameCallableIdentity(type.getMethodSignature(), signature);
        });
    }

    private isPromiseThen(stmt: Stmt): boolean {
        return stmt.getInvokeExpr()?.getMethodSignature()
            .getMethodSubSignature().getMethodName() === 'then';
    }

    private isPromiseContinuation(stmt: Stmt): boolean {
        const methodName = stmt.getInvokeExpr()?.getMethodSignature()
            .getMethodSubSignature().getMethodName();
        return methodName === 'then' || methodName === 'catch' || methodName === 'finally';
    }

    private isExecutableAsyncBoundary(stmt: Stmt): boolean {
        const methodName = stmt.getInvokeExpr()?.getMethodSignature()
            .getMethodSubSignature().getMethodName();
        return methodName === 'then' || methodName === 'catch' || methodName === 'finally' ||
            methodName === 'setTimeout' || methodName === 'setInterval';
    }

    private findCapturedClosureRef(callee: ArkMethod, capturedName: string): ClosureFieldRef | null {
        const startingBlock = callee.getCfg()?.getStartingBlock();
        if (!startingBlock) {
            return null;
        }
        for (const stmt of startingBlock.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) {
                continue;
            }
            const rightOp = stmt.getRightOp();
            if (rightOp instanceof ClosureFieldRef && rightOp.getFieldName() === capturedName) {
                return rightOp;
            }
        }
        return null;
    }

    private definesAccessPath(stmt: ArkAssignStmt, accessPath: NullnessAccessPath): boolean {
        const definedPath = NullnessAccessPath.fromValue(stmt.getLeftOp());
        if (definedPath.isEmpty()) return false;
        const rightOp = stmt.getRightOp();
        // Method-entry identity bindings and closure loads establish aliases;
        // they are not writes to the underlying receiver/captured storage.
        const isEntryBinding = rightOp instanceof ArkThisRef ||
            rightOp instanceof ArkParameterRef || rightOp instanceof ClosureFieldRef;
        if (isEntryBinding) return false;
        // A strong update kills the assigned storage cell and every fact rooted
        // below it.  Captured locals need the alias check as well: ArkIR loads a
        // closure field into a Local at callback entry, so assigning that Local
        // must also kill the stale `%closuresN.field` representation.
        if (definedPath.equals(accessPath)) return true;
        if (definedPath.isLocal() && definedPath.base === accessPath.base &&
            definedPath.isPrefixOf(accessPath)) {
            return true;
        }
        return (definedPath.fields.length > 0 && definedPath.isPrefixOf(accessPath)) ||
            this.accessPathsAlias(definedPath, accessPath);
    }

    private narrowFactOnBranch(
        srcStmt: Stmt,
        tgtStmt: Stmt,
        fact: NullnessFact
    ): NullnessFact | null {
        if (!(srcStmt instanceof ArkIfStmt)) {
            return fact;
        }
        const branchTruth = this.getBranchTruth(srcStmt, tgtStmt);
        if (branchTruth === undefined) {
            return fact;
        }

        return this.narrowFactForBooleanValue(
            srcStmt.getConditionExpr(),
            branchTruth,
            fact,
            srcStmt,
            new Set()
        );
    }

    private narrowFactForBooleanValue(
        value: unknown,
        expectedTruth: boolean,
        fact: NullnessFact,
        branchStmt: ArkIfStmt,
        visited: Set<unknown>
    ): NullnessFact | null {
        if (!value || visited.has(value)) {
            return fact;
        }
        visited.add(value);

        if (value instanceof ArkUnopExpr && value.getOperator() === UnaryOperator.LogicalNot) {
            return this.narrowFactForBooleanValue(
                value.getOp(),
                !expectedTruth,
                fact,
                branchStmt,
                visited
            );
        }

        // `value instanceof Type` is true only for a non-null object. ArkIR
        // frequently stores this predicate in a boolean Local; the Local case
        // below recursively reaches this expression.
        if (value instanceof ArkInstanceOfExpr) {
            const checkedPath = NullnessAccessPath.fromValue(value.getOp());
            if (expectedTruth && !checkedPath.isEmpty() &&
                this.accessPathsAlias(checkedPath, fact.accessPath)) {
                return null;
            }
            return fact;
        }

        // Project predicates such as `isInPlayReadyState()` often encode a
        // class invariant rather than testing the nullable resource directly.
        // Recognize only the narrow, source-backed pattern implemented below.
        if (value instanceof ArkInstanceInvokeExpr && expectedTruth &&
            this.projectReadyPredicateEstablishesNonNull(value, fact, branchStmt)) {
            return null;
        }

        // A truthy value cannot be null or undefined.  ArkIR commonly keeps
        // guards such as `if (value)` as a Local, or as a temporary Local whose
        // defining assignment reads a field.  Nullness facts only represent the
        // nullish alternatives, so the truthy edge kills the matching fact.
        const truthinessPath = NullnessAccessPath.fromValue(value as Value);
        if (!truthinessPath.isEmpty() &&
            (this.accessPathsAlias(truthinessPath, fact.accessPath) ||
                this.canonicalAccessPath(fact.accessPath, new Set()).isPrefixOf(
                    this.canonicalAccessPath(truthinessPath, new Set())
                ))) {
            if (!expectedTruth) {
                return fact;
            }
            const narrowedKind = removeNullish(fact.kind);
            return narrowedKind
                ? fact.deriveWithKind(narrowedKind, branchStmt)
                : null;
        }

        if (value instanceof Local) {
            const declaringStmt = value.getDeclaringStmt();
            if (declaringStmt instanceof ArkAssignStmt) {
                return this.narrowFactForBooleanValue(
                    declaringStmt.getRightOp(),
                    expectedTruth,
                    fact,
                    branchStmt,
                    visited
                );
            }
            return fact;
        }

        if (value instanceof ArkNormalBinopExpr) {
            const operator = value.getOperator();
            const shouldNarrowBoth =
                (operator === NormalBinaryOperator.LogicalAnd && expectedTruth) ||
                (operator === NormalBinaryOperator.LogicalOr && !expectedTruth);
            if (!shouldNarrowBoth) {
                return fact;
            }
            const afterFirst = this.narrowFactForBooleanValue(
                value.getOp1(),
                expectedTruth,
                fact,
                branchStmt,
                new Set(visited)
            );
            return afterFirst
                ? this.narrowFactForBooleanValue(
                    value.getOp2(),
                    expectedTruth,
                    afterFirst,
                    branchStmt,
                    new Set(visited)
                )
                : null;
        }

        if (!(value instanceof ArkConditionExpr)) {
            return fact;
        }

        const operator = value.getOperator();
        const equalityOperator = operator === RelationalBinaryOperator.Equality ||
            operator === RelationalBinaryOperator.StrictEquality;
        const inequalityOperator = operator === RelationalBinaryOperator.InEquality ||
            operator === RelationalBinaryOperator.StrictInequality;
        if (!equalityOperator && !inequalityOperator) {
            return fact;
        }

        const op1 = value.getOp1();
        const op2 = value.getOp2();
        const booleanOperand = op1 instanceof BooleanConstant
            ? op1
            : op2 instanceof BooleanConstant
                ? op2
                : null;
        if (booleanOperand) {
            const comparedValue = booleanOperand === op1 ? op2 : op1;
            const equalityHolds = equalityOperator ? expectedTruth : !expectedTruth;
            const booleanValue = booleanOperand.getValue() === 'true';
            return this.narrowFactForBooleanValue(
                comparedValue,
                equalityHolds ? booleanValue : !booleanValue,
                fact,
                branchStmt,
                visited
            );
        }

        // ArkAnalyzer lowers ordinary truthiness checks to comparisons with a
        // type-specific falsy sentinel, for example `value != 0` for objects and
        // `value != ''` for strings.  Recover the source-level truthiness guard
        // so aliases loaded from fields are narrowed on the protected edge too.
        const falsyOperand = this.isLoweredTruthinessGuard(branchStmt) && isFalsySentinel(op1)
            ? op1
            : this.isLoweredTruthinessGuard(branchStmt) && isFalsySentinel(op2)
                ? op2
                : null;
        if (falsyOperand) {
            const comparedValue = falsyOperand === op1 ? op2 : op1;
            const equalityHolds = equalityOperator ? expectedTruth : !expectedTruth;
            return this.narrowFactForBooleanValue(
                comparedValue,
                !equalityHolds,
                fact,
                branchStmt,
                visited
            );
        }

        const nullishOperand = op1 instanceof NullConstant || op1 instanceof UndefinedConstant
            ? op1
            : op2 instanceof NullConstant || op2 instanceof UndefinedConstant
                ? op2
                : null;
        if (!nullishOperand) {
            return fact;
        }
        const comparedValue = nullishOperand === op1 ? op2 : op1;
        const comparedPath = NullnessAccessPath.fromValue(comparedValue);
        if (comparedPath.isEmpty() ||
            !this.accessPathsAlias(comparedPath, fact.accessPath)) {
            return fact;
        }

        const equalityHolds = equalityOperator ? expectedTruth : !expectedTruth;
        const strictComparison = operator === RelationalBinaryOperator.StrictEquality ||
            operator === RelationalBinaryOperator.StrictInequality;
        let narrowedKind: NullnessKind | null;
        if (!strictComparison) {
            // JavaScript/ArkTS loose null equality matches both null and undefined.
            narrowedKind = equalityHolds
                ? fact.kind
                : removeNullish(fact.kind);
        } else if (nullishOperand instanceof NullConstant) {
            narrowedKind = equalityHolds ? keepOnlyNull(fact.kind) : removeNull(fact.kind);
        } else {
            narrowedKind = equalityHolds ? keepOnlyUndefined(fact.kind) : removeUndefined(fact.kind);
        }

        if (!narrowedKind) {
            return null;
        }
        return narrowedKind === fact.kind ? fact : fact.deriveWithKind(narrowedKind, branchStmt);
    }

    private getBranchTruth(srcStmt: ArkIfStmt, tgtStmt: Stmt): boolean | undefined {
        const cfg = srcStmt.getCfg();
        if (!cfg) {
            return undefined;
        }
        const blocks = [...cfg.getBlocks()];
        const sourceBlock = blocks.find(block => block.getStmts().includes(srcStmt));
        const targetBlock = blocks.find(block => block.getStmts().includes(tgtStmt));
        if (!sourceBlock || !targetBlock) {
            return undefined;
        }
        const successors = sourceBlock.getSuccessors();
        if (successors.length !== 2 || successors[0] === successors[1]) {
            return undefined;
        }
        if (successors[0] === targetBlock) {
            return true;
        }
        if (successors[1] === targetBlock) {
            return false;
        }
        return undefined;
    }

    private isLoweredTruthinessGuard(stmt: ArkIfStmt): boolean {
        const originalText = typeof stmt.getOriginalText === 'function'
            ? stmt.getOriginalText()
            : undefined;
        if (!originalText) return true;
        const conditionHeader = originalText.split('{', 1)[0];
        return !/(?:===|!==|==|!=)/.test(stripCommentsAndLiterals(conditionHeader));
    }

    /**
     * Models a common class protocol: a monotonic resource is created once,
     * while an `is...ReadyState` predicate excludes the initial not-ready
     * state.  This is intentionally stricter than a name heuristic: the class
     * must contain a definite non-null write, no later nullish reset, and a
     * state initializer distinct from every state accepted by the predicate.
     */
    private projectReadyPredicateEstablishesNonNull(
        invokeExpr: ArkInstanceInvokeExpr,
        fact: NullnessFact,
        branchStmt: ArkIfStmt
    ): boolean {
        const methodName = invokeExpr.getMethodSignature()
            .getMethodSubSignature().getMethodName();
        if (!/^is[A-Z]\w*ReadyState$/.test(methodName)) return false;

        const receiverPath = this.canonicalAccessPath(
            NullnessAccessPath.fromValue(invokeExpr.getBase()),
            new Set()
        );
        const factPath = this.canonicalAccessPath(fact.accessPath, new Set());
        if (receiverPath.isEmpty() || factPath.isEmpty() ||
            !receiverPath.isPrefixOf(factPath) ||
            factPath.fields.length !== receiverPath.fields.length + 1) {
            return false;
        }
        const resourceField = factPath.fields.at(-1)!.getFieldName();
        const declaringClass = branchStmt.getCfg()?.getDeclaringMethod()
            .getDeclaringArkClass();
        const predicate = declaringClass?.getMethods().find(method =>
            method.getName() === methodName
        );
        if (!declaringClass || !predicate) return false;

        let methodCache = this.relationalGuardCache.get(predicate);
        if (!methodCache) {
            methodCache = new Map<string, boolean>();
            this.relationalGuardCache.set(predicate, methodCache);
        }
        const cached = methodCache.get(resourceField);
        if (cached !== undefined) return cached;

        const predicateCode = predicate.getCode() ?? '';
        const comparisons = [...predicateCode.matchAll(
            /this\.([A-Za-z_$][\w$]*)\s*===\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+|['"][^'"]+['"])/g
        )];
        const stateFields = new Set(comparisons.map(match => match[1]));
        if (comparisons.length === 0 || stateFields.size !== 1) {
            methodCache.set(resourceField, false);
            return false;
        }

        const stateField = comparisons[0][1];
        const acceptedStates = new Set(comparisons.map(match => match[2]));
        const classCode = declaringClass.getCode() ?? '';
        const stateInitializer = classCode.match(new RegExp(
            `(?:private\\s+|protected\\s+|public\\s+)?${escapeRegExp(stateField)}` +
            `\\s*(?::[^=\\n]+)?=\\s*([^;\\n]+)`
        ))?.[1]?.trim();
        if (!stateInitializer || acceptedStates.has(stateInitializer)) {
            methodCache.set(resourceField, false);
            return false;
        }

        let hasDefiniteWrite = false;
        let hasNullishReset = false;
        for (const method of declaringClass.getMethods(true)) {
            for (const block of method.getCfg()?.getBlocks() ?? []) {
                for (const stmt of block.getStmts()) {
                    if (!(stmt instanceof ArkAssignStmt)) continue;
                    const leftPath = this.canonicalAccessPath(
                        NullnessAccessPath.fromValue(stmt.getLeftOp()),
                        new Set()
                    );
                    if (leftPath.base?.getName() !== 'this' ||
                        leftPath.fields.length !== 1 ||
                        leftPath.fields[0].getFieldName() !== resourceField) {
                        continue;
                    }
                    const rightOp = stmt.getRightOp();
                    const nullishKind = this.getLiteralNullnessKind(rightOp);
                    if (nullishKind) {
                        if (!method.getName().startsWith('%instInit')) {
                            hasNullishReset = true;
                        }
                        continue;
                    }
                    const renderedType = tryRenderArkType(rightOp.getType());
                    if (renderedType === null) {
                        continue;
                    }
                    const typeName = renderedType.toLowerCase();
                    if (!/(?:^|[| ])(?:null|undefined|unknown|any)(?:$|[| ])/.test(typeName)) {
                        hasDefiniteWrite = true;
                    }
                }
            }
        }

        const establishesNonNull = hasDefiniteWrite && !hasNullishReset;
        methodCache.set(resourceField, establishesNonNull);
        return establishesNonNull;
    }

    private propagateAssignment(stmt: ArkAssignStmt, fact: NullnessFact): Set<NullnessFact> {
        const result = new Set<NullnessFact>();
        const rightOp = stmt.getRightOp();
        const leftPath = NullnessAccessPath.fromValue(stmt.getLeftOp());
        if (leftPath.isEmpty() || leftPath.isZero()) {
            return result;
        }

        if (rightOp instanceof ArkNormalBinopExpr &&
            rightOp.getOperator() === NormalBinaryOperator.NullishCoalescing) {
            const fallbackPath = NullnessAccessPath.fromValue(rightOp.getOp2());
            if (!fallbackPath.isEmpty() && fallbackPath.isPrefixOf(fact.accessPath)) {
                const remainingFields = fact.accessPath.fields.slice(fallbackPath.fields.length);
                result.add(fact.deriveWithNewAccessPath(
                    new NullnessAccessPath(
                        leftPath.base,
                        leftPath.baseType,
                        [...leftPath.fields, ...remainingFields],
                        leftPath.isStatic
                    ),
                    stmt
                ));
            }
            return result;
        }

        if (rightOp instanceof ArkInstanceFieldRef && this.isOptionalChainStmt(stmt)) {
            const receiverPath = NullnessAccessPath.fromValue(rightOp.getBase());
            if (receiverPath.equals(fact.accessPath)) {
                result.add(fact
                    .deriveWithNewAccessPath(leftPath, stmt)
                    .deriveWithKind(NullnessKind.Undefined, stmt));
            }
        }

        // ArkIR keeps `await` as an explicit wrapper around the value produced by
        // the async call. Until Promise payload summaries are introduced, unwrap
        // this ordinary IR node so project-defined async returns keep their facts.
        const propagatedValue = rightOp instanceof ArkAwaitExpr
            ? rightOp.getPromise()
            : rightOp;
        const rightPath = NullnessAccessPath.fromValue(propagatedValue);
        if (rightPath.isEmpty() || !rightPath.isPrefixOf(fact.accessPath)) {
            return result;
        }

        const remainingFields = fact.accessPath.fields.slice(rightPath.fields.length);
        const mappedPath = new NullnessAccessPath(
            leftPath.base,
            leftPath.baseType,
            [...leftPath.fields, ...remainingFields],
            leftPath.isStatic
        );
        const declaringMethod = stmt.getCfg()?.getDeclaringMethod();
        if (leftPath.fields.length > 0 && rightPath.isLocal() &&
            declaringMethod?.getName().startsWith('%AM')) {
            result.add(NullnessFact.create(mappedPath, fact.kind, {
                kind: fact.origin?.kind ?? NullnessOriginKind.Unknown,
                stmt,
                description: 'nullable callback value assigned to a field',
            }));
        } else {
            result.add(fact.deriveWithNewAccessPath(mappedPath, stmt));
        }
        return result;
    }

    private checkDirectDereference(stmt: Stmt, fact: NullnessFact): void {
        if ((!mayBeNull(fact.kind) && !mayBeUndefined(fact.kind)) ||
            !fact.origin || typeof stmt.getUses !== 'function') {
            return;
        }
        if (fact.isUnresolvedEvidence() && !this.config.reportUnresolvedReturns) {
            return;
        }
        const fieldReceivers = stmt.getUses()
            .filter((value): value is ArkInstanceFieldRef => value instanceof ArkInstanceFieldRef)
            .map(fieldRef => NullnessAccessPath.fromValue(fieldRef.getBase()));
        const invokeReceivers = stmt.getUses()
            .filter((value): value is ArkInstanceInvokeExpr => value instanceof ArkInstanceInvokeExpr)
            .map(invokeExpr => NullnessAccessPath.fromValue(invokeExpr.getBase()));
        const arrayReceivers = stmt.getUses()
            .filter((value): value is ArkArrayRef => value instanceof ArkArrayRef)
            .map(arrayRef => NullnessAccessPath.fromValue(arrayRef.getBase()));
        const invoke = stmt.getInvokeExpr();
        const nonNullArgumentPaths = invoke
            ? this.libraryRegistry.getNonNullArgumentIndices(stmt)
                .map(index => invoke.getArgs()[index])
                .filter((value): value is Value => value !== undefined)
                .map(value => NullnessAccessPath.fromValue(value))
                .filter(path => !path.isEmpty())
            : [];
        const dereferencedPaths = [...fieldReceivers, ...invokeReceivers, ...arrayReceivers];
        const isReceiverDereference = dereferencedPaths.some(path =>
            this.accessPathsAlias(path, fact.accessPath)
        );
        const isNonNullArgumentUse = nonNullArgumentPaths.some(path =>
            this.accessPathsAlias(path, fact.accessPath)
        );
        if ((!isReceiverDereference && !isNonNullArgumentUse) ||
            (isReceiverDereference && !this.shouldReportDereference(stmt, fact))) {
            return;
        }
        if (isReceiverDereference &&
            this.isBareTemplateInterpolationCoercion(stmt, fact.accessPath)) {
            return;
        }
        if (this.isSourceShortCircuitGuarded(stmt, fact.accessPath)) {
            return;
        }
        if (this.isSourceConditionallyAssignedAndGuarded(stmt, fact.accessPath)) {
            return;
        }
        if (this.isSourceOptionalCallGuarded(stmt, fact.accessPath)) {
            return;
        }
        if (this.isSourceOptionalLocalGuarded(stmt, fact.accessPath)) {
            return;
        }
        if (this.isLexicallyContainedInOptionalCallGuard(stmt, fact.accessPath)) {
            return;
        }
        if (this.isLexicallyContainedInOptionalLocalGuard(stmt, fact.accessPath)) {
            return;
        }
        if (this.isLexicallyContainedInTruthyGuard(stmt, fact.accessPath)) {
            return;
        }
        if (stmt instanceof ArkIfStmt &&
            this.isDereferenceProtectedByShortCircuit(stmt.getConditionExpr(), fact, stmt)) {
            return;
        }
        if (this.isProvenNonNullByDominatingGuard(stmt, fact)) {
            return;
        }
        if (this.isInitializedByEveryConcreteSubclass(stmt, fact)) {
            return;
        }

        const sourceStmt = fact.origin.stmt as Stmt;
        const sourceLocation = this.getLocation(sourceStmt);
        const dereferenceLocation = this.getLocation(stmt);
        if (this.nullDereferences.some(diagnostic =>
            this.sameLocation(diagnostic.dereferenceLocation, dereferenceLocation) &&
            this.accessPathsAlias(diagnostic.accessPath, fact.accessPath))) {
            return;
        }

        this.nullDereferences.push({
            kind: 'null-dereference',
            nullness: fact.kind,
            accessPath: fact.accessPath,
            sourceStmt,
            dereferenceStmt: stmt,
            sourceLocation,
            dereferenceLocation,
            description: isNonNullArgumentUse && !isReceiverDereference
                ? `${fact.kind === NullnessKind.MaybeNull ||
                    fact.kind === NullnessKind.MaybeUndefined ||
                    fact.kind === NullnessKind.MaybeNullish ? 'Potential' : 'Definite'} ` +
                    `nullish value passed to a non-null parameter: ${fact.accessPath.toString()}`
                : fact.kind === NullnessKind.MaybeNull ||
                    fact.kind === NullnessKind.MaybeUndefined ||
                    fact.kind === NullnessKind.MaybeNullish
                    ? `Potential nullish dereference of ${fact.accessPath.toString()}`
                    : `Definite ${fact.kind} dereference of ${fact.accessPath.toString()}`,
            confidence: fact.isUnresolvedEvidence() ? 'low' : 'high',
        });
    }

    /**
     * Detect `value!.field || value === undefined` before fact propagation.
     * The right operand cannot protect a dereference already evaluated by the
     * left operand, even when no explicit nullish assignment is reachable.
     */
    private checkLateNullGuard(stmt: Stmt): void {
        const originalText = stmt.getOriginalText?.();
        if (!originalText || !originalText.includes('||')) return;
        const source = stripCommentsAndLiterals(originalText);
        const assertionPattern = /((?:this\s*\.\s*)?[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)!(?!=)\s*(?:\.|\[|\()/g;
        for (const match of source.matchAll(assertionPattern)) {
            const sourceName = match[1].replace(/\s+/g, '');
            const tail = source.slice((match.index ?? 0) + match[0].length);
            const escapedName = escapeRegExp(sourceName).replace(/\\\./g, '\\s*\\.\\s*');
            const guardedAfterDereference = new RegExp(
                `\\|\\|[\\s\\S]*(?:${escapedName}\\s*(?:===|==)\\s*(null|undefined)|` +
                `(null|undefined)\\s*(?:===|==)\\s*${escapedName})`
            ).exec(`||${tail}`);
            if (!guardedAfterDereference) continue;

            const guardedValue = guardedAfterDereference[1] ?? guardedAfterDereference[2];
            const candidates = stmt.getUses().flatMap(value => {
                if (value instanceof ArkInstanceFieldRef || value instanceof ArkArrayRef) {
                    return [NullnessAccessPath.fromValue(value.getBase())];
                }
                if (value instanceof ArkInstanceInvokeExpr) {
                    return [NullnessAccessPath.fromValue(value.getBase())];
                }
                return [];
            }).map(path => this.canonicalAccessPath(path, new Set()));
            const accessPath = candidates.find(path => {
                const rendered = path.toString().replace(/\s+/g, '');
                return rendered === sourceName || rendered.endsWith(`.${sourceName}`) ||
                    sourceName.endsWith(`.${rendered}`);
            });
            if (!accessPath || accessPath.isEmpty()) continue;

            const location = this.getLocation(stmt);
            if (this.nullDereferences.some(diagnostic =>
                this.sameLocation(diagnostic.dereferenceLocation, location) &&
                this.accessPathsAlias(diagnostic.accessPath, accessPath))) {
                continue;
            }
            const kind = guardedValue === 'null'
                ? NullnessKind.MaybeNull
                : NullnessKind.MaybeUndefined;
            this.nullDereferences.push({
                kind: 'null-dereference',
                nullness: kind,
                accessPath,
                sourceStmt: stmt,
                dereferenceStmt: stmt,
                sourceLocation: location,
                dereferenceLocation: location,
                description: `Potential nullish dereference of ${accessPath.toString()} before its null check`,
                confidence: 'high',
            });
        }
    }

    /** Report a registered non-null API argument when its declared type is nullable. */
    private checkTypedNonNullArguments(stmt: Stmt): void {
        const invoke = stmt.getInvokeExpr();
        if (!invoke) return;
        for (const index of this.libraryRegistry.getNonNullArgumentIndices(stmt)) {
            const argument = invoke.getArgs()[index];
            if (!argument) continue;
            const accessPath = NullnessAccessPath.fromValue(argument);
            const kind = this.getTypeNullness(argument.getType());
            if (accessPath.isEmpty() || !kind ||
                this.isRequiredComponentField(stmt, accessPath)) continue;
            this.checkDirectDereference(stmt, NullnessFact.create(accessPath, kind, {
                kind: NullnessOriginKind.Uninitialized,
                stmt,
                description: 'nullable value used where the API requires a non-null argument',
            }));
        }
    }

    private getTypeNullness(type: Type): NullnessKind | null {
        const alternatives = { null: false, undefined: false, nonNull: false };
        const visit = (candidate: Type, visited: Set<Type>): void => {
            if (visited.has(candidate)) return;
            visited.add(candidate);
            if (candidate instanceof AliasType) {
                visit(candidate.getOriginalType(), visited);
            } else if (candidate instanceof UnionType) {
                for (const member of candidate.getTypes()) visit(member, visited);
            } else if (candidate instanceof NullType) {
                alternatives.null = true;
            } else if (candidate instanceof UndefinedType) {
                alternatives.undefined = true;
            } else {
                alternatives.nonNull = true;
            }
        };
        visit(type, new Set());
        if (!alternatives.null && !alternatives.undefined) {
            // Some unresolved ArkIR types retain a useful union only in their
            // rendered form. Accept explicit null/undefined members, not any.
            const rendered = tryRenderArkType(type);
            if (rendered === null) return null;
            alternatives.null = /(?:^|\|)null(?:\||$)/.test(rendered);
            alternatives.undefined = /(?:^|\|)undefined(?:\||$)/.test(rendered);
            if (!alternatives.null && !alternatives.undefined) return null;
            alternatives.nonNull = true;
        }
        if (alternatives.null && alternatives.undefined) return NullnessKind.MaybeNullish;
        if (alternatives.null) {
            return alternatives.nonNull ? NullnessKind.MaybeNull : NullnessKind.Null;
        }
        return alternatives.nonNull ? NullnessKind.MaybeUndefined : NullnessKind.Undefined;
    }

    private sameLocation(
        left: NullnessSourceLocation,
        right: NullnessSourceLocation
    ): boolean {
        return left.filePath === right.filePath && left.line === right.line &&
            left.col === right.col;
    }

    /** Preserve static-field effects across lifecycle callbacks with partial order. */
    private recordStaticNullFact(fact: NullnessFact): void {
        if (!fact.accessPath.isStaticFieldRef() ||
            this.staticNullFacts.some(existing => existing.equals(fact))) {
            return;
        }
        this.staticNullFacts.push(fact);
        for (const site of this.staticDereferenceSites) {
            if (this.accessPathsAlias(site.path, fact.accessPath)) {
                this.checkDirectDereference(site.stmt, fact);
            }
        }
    }

    private recordStaticDereferenceSite(stmt: Stmt): void {
        if (typeof stmt.getUses !== 'function') return;
        const receivers = stmt.getUses().flatMap(value => {
            if (value instanceof ArkInstanceFieldRef || value instanceof ArkArrayRef) {
                return [NullnessAccessPath.fromValue(value.getBase())];
            }
            if (value instanceof ArkInstanceInvokeExpr) {
                return [NullnessAccessPath.fromValue(value.getBase())];
            }
            return [];
        });
        for (const receiver of receivers) {
            const canonical = this.canonicalAccessPath(receiver, new Set());
            if (!canonical.isStaticFieldRef() || this.staticDereferenceSites.some(site =>
                site.stmt === stmt && site.path.equals(canonical))) {
                continue;
            }
            this.staticDereferenceSites.push({ path: canonical, stmt });
            for (const fact of this.staticNullFacts) {
                if (this.accessPathsAlias(canonical, fact.accessPath)) {
                    this.checkDirectDereference(stmt, fact);
                }
            }
        }
    }

    /**
     * Recover the positive (Must-NonNull) side of a dominating guard. This is
     * needed when ArkIR reloads a guarded field into a fresh temporary after the
     * branch, because that temporary can otherwise acquire a stale nullish fact.
     */
    private isProvenNonNullByDominatingGuard(stmt: Stmt, fact: NullnessFact): boolean {
        const cfg = stmt.getCfg();
        if (!cfg) return false;
        const blocks = [...cfg.getBlocks()];
        const targetBlock = blocks.find(block => block.getStmts().includes(stmt));
        if (!targetBlock) return false;

        for (const block of blocks) {
            const branchStmt = block.getTail();
            if (!(branchStmt instanceof ArkIfStmt)) continue;

            // Repeated calls to a getter-like project helper receive different
            // SSA temporaries. Recover the source-level invariant established by
            // `if (getValue(...)?.field) { getValue(...)!.field... }`.
            if (this.isPositiveStableCallGuard(branchStmt, fact.accessPath)) {
                const branchSource = branchStmt.getOriginalText?.();
                const targetSource = stmt.getOriginalText?.()?.trim();
                // ArkUI builder lowering can connect both CFG successors to the
                // same synthetic builder block. Source containment still
                // preserves the lexical fact that the target is inside the
                // guarded body.
                if (branchSource && targetSource && branchSource.includes(targetSource)) {
                    return true;
                }
            }

            const successors = block.getSuccessors();
            if (successors.length !== 2 || successors[0] === successors[1]) continue;

            if (this.isPositiveStableCallGuard(branchStmt, fact.accessPath)) {
                const safeReachesTarget = this.blockReaches(successors[0], targetBlock);
                const unsafeReachesTarget = this.blockReaches(successors[1], targetBlock);
                if (safeReachesTarget && !unsafeReachesTarget) {
                    return true;
                }
            }

            const narrowed = successors.map(successor => {
                const head = successor.getHead();
                return head ? this.narrowFactOnBranch(branchStmt, head, fact) : fact;
            });
            const safeIndex = narrowed[0] === null && narrowed[1] !== null
                ? 0
                : narrowed[1] === null && narrowed[0] !== null
                    ? 1
                    : -1;
            if (safeIndex < 0) continue;

            const safeReachesTarget = this.blockReaches(successors[safeIndex], targetBlock);
            const unsafeReachesTarget = this.blockReaches(successors[1 - safeIndex], targetBlock);
            if (safeReachesTarget && !unsafeReachesTarget) {
                return true;
            }
        }
        return false;
    }

    private blockReaches(start: { getSuccessors(): unknown[] }, target: unknown): boolean {
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

    /** Compare SSA temporaries and field reloads through their defining assignments. */
    private accessPathsAlias(left: NullnessAccessPath, right: NullnessAccessPath): boolean {
        if (left.equals(right)) return true;
        return this.canonicalAccessPath(left, new Set()).equals(
            this.canonicalAccessPath(right, new Set())
        );
    }

    private canonicalAccessPath(
        accessPath: NullnessAccessPath,
        visited: Set<Local>
    ): NullnessAccessPath {
        // NullnessAccessPath deliberately exposes a small local contract; this
        // routine needs ArkAnalyzer's concrete declaring-statement API.
        const base = accessPath.base as Local | null;
        if (!base || visited.has(base)) return accessPath;
        visited.add(base);
        const declaringStmt = base.getDeclaringStmt();
        if (!(declaringStmt instanceof ArkAssignStmt)) return accessPath;
        const assignedPath = NullnessAccessPath.fromValue(declaringStmt.getRightOp());
        if (assignedPath.isEmpty() || assignedPath.isZero()) return accessPath;

        const canonicalBase = this.canonicalAccessPath(assignedPath, visited);
        return new NullnessAccessPath(
            canonicalBase.base,
            canonicalBase.baseType,
            [...canonicalBase.fields, ...accessPath.fields],
            canonicalBase.isStatic
        );
    }

    /**
     * Avoid reporting the right-hand side of `value && value.member` after the
     * left-hand side has established that the same access path is truthy.  The
     * analogous rule for `||` uses the falsy edge.  This is deliberately limited
     * to boolean conditions; ordinary calls and assignments stay conservative.
     */
    private isDereferenceProtectedByShortCircuit(
        value: Value,
        fact: NullnessFact,
        branchStmt: ArkIfStmt
    ): boolean {
        if (!(value instanceof ArkNormalBinopExpr)) {
            return false;
        }
        const operator = value.getOperator();
        if (operator !== NormalBinaryOperator.LogicalAnd &&
            operator !== NormalBinaryOperator.LogicalOr) {
            return false;
        }

        const left = value.getOp1();
        const right = value.getOp2();
        const leftDereferences = this.valueDereferencesAccessPath(left, fact.accessPath);
        const rightDereferences = this.valueDereferencesAccessPath(right, fact.accessPath);
        if (!rightDereferences || leftDereferences) {
            return false;
        }

        const rightEvaluationTruth = operator === NormalBinaryOperator.LogicalAnd;
        const narrowed = this.narrowFactForBooleanValue(
            left,
            rightEvaluationTruth,
            fact,
            branchStmt,
            new Set()
        );
        return narrowed === null ||
            this.isDereferenceProtectedByShortCircuit(right, narrowed, branchStmt);
    }

    private valueDereferencesAccessPath(
        value: Value,
        accessPath: NullnessAccessPath
    ): boolean {
        const values = [value, ...value.getUses()];
        return values.some(used => {
            if (used instanceof ArkInstanceFieldRef || used instanceof ArkArrayRef) {
                return NullnessAccessPath.fromValue(used.getBase()).equals(accessPath);
            }
            if (used instanceof ArkInstanceInvokeExpr) {
                return NullnessAccessPath.fromValue(used.getBase()).equals(accessPath);
            }
            return false;
        });
    }

    /**
     * ArkIR currently emits the member read in `value && value.member` before
     * the logical-and temporary.  Recover this source-level evaluation order so
     * that the synthetic eager read is not diagnosed.  Only a direct local-name
     * guard in the same source expression is accepted.
     */
    private isSourceShortCircuitGuarded(
        stmt: Stmt,
        accessPath: NullnessAccessPath
    ): boolean {
        if (!accessPath.isLocal() || accessPath.fields.length !== 0) {
            return false;
        }
        const name = accessPath.base?.getName();
        const originalText = typeof stmt.getOriginalText === 'function'
            ? stmt.getOriginalText()
            : undefined;
        if (!name || !originalText) {
            return false;
        }
        const source = stripCommentsAndLiterals(originalText);
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const truthyAnd = new RegExp(
            `\\b${escapedName}\\b\\s*&&[\\s\\S]*\\b${escapedName}\\b\\s*(?:\\.|\\[|\\()`
        ).test(source);
        if (truthyAnd) return true;

        const comparedAnd = new RegExp(
            `\\b${escapedName}\\b\\s*(?:!==|!=)\\s*(?:undefined|null)\\s*&&[\\s\\S]*` +
            `\\b${escapedName}\\b\\s*(?:\\.|\\[|\\()`
        ).test(source);
        if (comparedAnd) return true;

        const falsyOr = new RegExp(
            `!\\s*\\b${escapedName}\\b\\s*\\|\\|[\\s\\S]*` +
            `\\b${escapedName}\\b\\s*(?:\\.|\\[|\\()`
        ).test(source);
        if (falsyOr) return true;

        // The right-hand side of `!(value instanceof T) || value.member`
        // runs only when the instanceof predicate is true. ArkIR currently
        // materializes `value.member` before the final logical-or node, so the
        // normal edge-sensitive narrowing cannot protect this synthetic read.
        return new RegExp(
            `!\\s*\\(\\s*${escapedName}\\s+instanceof\\s+[^)]+\\)\\s*\\|\\|[\\s\\S]*` +
            `\\b${escapedName}\\b\\s*(?:\\.|\\[|\\()`
        ).test(source);
    }

    /** Suppress ArkIR's eager reads inside a source-level optional-call guard. */
    private isSourceOptionalCallGuarded(
        stmt: Stmt,
        accessPath: NullnessAccessPath
    ): boolean {
        const methodName = this.getStableCallMethodName(accessPath, new Set());
        const originalText = typeof stmt.getOriginalText === 'function'
            ? stmt.getOriginalText()
            : undefined;
        if (!methodName || !originalText) return false;
        const header = stripCommentsAndLiterals(originalText).split('{', 1)[0];
        const escaped = methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\s*\\([^)]*\\)\\s*\\?\\.`).test(header);
    }

    private isSourceOptionalLocalGuarded(
        stmt: Stmt,
        accessPath: NullnessAccessPath
    ): boolean {
        if (!accessPath.isLocal()) return false;
        const name = accessPath.base?.getName();
        const originalText = stmt.getOriginalText?.();
        if (!name || !originalText) return false;
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b\\s*\\?\\.`).test(
            stripCommentsAndLiterals(originalText).split('{', 1)[0]
        );
    }

    /**
     * Recover the last truthy assignment in a lowered source-level `||` guard.
     * This is deliberately restricted to a condition whose earlier alternatives
     * are all dispatched by the ternary chain before the asserted access.
     */
    private isSourceConditionallyAssignedAndGuarded(
        stmt: Stmt,
        accessPath: NullnessAccessPath
    ): boolean {
        const canonical = this.canonicalAccessPath(accessPath, new Set());
        const name = canonical.base?.getName();
        const targetSource = stmt.getOriginalText?.();
        const cfg = stmt.getCfg();
        if (!name || name.startsWith('%') || !targetSource || !cfg) return false;
        const escaped = escapeRegExp(name);
        const sourceCandidates = new Set<string>([targetSource]);
        for (const block of cfg.getBlocks()) {
            for (const candidate of block.getStmts()) {
                const source = candidate.getOriginalText?.();
                if (source?.includes(targetSource)) sourceCandidates.add(source);
            }
        }
        for (const source of sourceCandidates) {
            const assignment = new RegExp(`\\(\\s*${escaped}\\s*=`, 'g');
            let match: RegExpExecArray | null;
            while ((match = assignment.exec(source)) !== null) {
                const ifIndex = source.lastIndexOf('if', match.index);
                if (ifIndex < 0) continue;
                const bodyMatch = /\)\s*\{/.exec(source.slice(match.index));
                if (!bodyMatch) continue;
                const bodyStart = match.index + bodyMatch.index + bodyMatch[0].length;
                const dereference = new RegExp(
                    `\\b${escaped}\\b\\s*!(?!=)\\s*(?:\\.|\\[)`
                ).exec(source.slice(bodyStart));
                if (!dereference) continue;
                const condition = source.slice(ifIndex, bodyStart);
                const alternatives = condition.split(/\|\|/);
                const targetAlternative = alternatives.findIndex(alternative =>
                    new RegExp(`\\b${escaped}\\s*=`).test(alternative)
                );
                if (targetAlternative < 1 || targetAlternative !== alternatives.length - 1) {
                    continue;
                }
                const bodyPrefix = source.slice(
                    bodyStart,
                    bodyStart + dereference.index
                ).replace(/\s+/g, ' ');
                const earlierAlternativesAreDispatched = alternatives
                    .slice(0, targetAlternative)
                    .every(alternative => {
                        const assignedName = /\(\s*([A-Za-z_$][\w$]*)\s*=(?!=)/
                            .exec(alternative)?.[1];
                        if (assignedName) {
                            return new RegExp(`\\b${escapeRegExp(assignedName)}\\b\\s*\\?`)
                                .test(bodyPrefix);
                        }
                        const comparison = /([A-Za-z_$][\w$]*\s*={2,3}\s*['"][^'"]+['"])/
                            .exec(alternative)?.[1];
                        return comparison !== undefined && bodyPrefix.includes(
                            comparison.replace(/\s+/g, ' ')
                        );
                    });
                if (earlierAlternativesAreDispatched) {
                    return true;
                }
            }
        }
        return false;
    }

    private isPositiveStableCallGuard(
        branchStmt: ArkIfStmt,
        accessPath: NullnessAccessPath
    ): boolean {
        const methodName = this.getStableCallMethodName(accessPath, new Set());
        const originalText = branchStmt.getOriginalText?.();
        if (!methodName || !originalText) return false;
        const header = stripCommentsAndLiterals(originalText).split('{', 1)[0];
        const escaped = methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const guardedCall = new RegExp(
            `\\b${escaped}\\s*\\([^)]*\\)\\s*(?:\\?\\.|\\)|&&)`
        ).test(header);
        const guardedGetter = new RegExp(
            `(?:\\bthis\\s*\\.\\s*)?\\b${escaped}\\b\\s*(?:\\?\\.|\\)|&&)`
        ).test(header);
        const negated = new RegExp(
            `!\\s*(?:(?:this\\s*\\.\\s*)?${escaped}\\b|${escaped}\\s*\\()`
        ).test(header);
        return (guardedCall || guardedGetter) && !negated;
    }

    /**
     * ArkUI DSL `If.create/If.branch` nodes do not form ordinary CFG branches.
     * Their statements nevertheless retain nested source text. Use the smallest
     * enclosing source fragment containing both the optional getter guard and
     * the target expression, which recovers the lexical guard without treating
     * the entire component build method as protected.
     */
    private isLexicallyContainedInOptionalCallGuard(
        stmt: Stmt,
        accessPath: NullnessAccessPath
    ): boolean {
        const methodName = this.getStableCallMethodName(accessPath, new Set());
        const targetSource = stmt.getOriginalText?.()?.trim();
        const cfg = stmt.getCfg();
        if (!methodName || !targetSource || !cfg) return false;
        const escaped = methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const guardPattern = new RegExp(
            `\\b${escaped}\\s*\\([^)]*\\)\\s*\\?\\.`
        );
        let smallestEnclosing: string | null = null;
        for (const block of cfg.getBlocks()) {
            for (const candidate of block.getStmts()) {
                const source = candidate.getOriginalText?.();
                if (!source || source === targetSource ||
                    !source.includes(targetSource) || !guardPattern.test(source)) {
                    continue;
                }
                if (!smallestEnclosing || source.length < smallestEnclosing.length) {
                    smallestEnclosing = source;
                }
            }
        }
        return smallestEnclosing !== null;
    }

    private isLexicallyContainedInOptionalLocalGuard(
        stmt: Stmt,
        accessPath: NullnessAccessPath
    ): boolean {
        if (!accessPath.isLocal()) return false;
        const name = accessPath.base?.getName();
        const targetSource = stmt.getOriginalText?.()?.trim();
        const cfg = stmt.getCfg();
        if (!name || !targetSource || !cfg) return false;
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const guardPattern = new RegExp(`\\b${escaped}\\b\\s*\\?\\.`);
        let smallestEnclosing: string | null = null;
        for (const block of cfg.getBlocks()) {
            for (const candidate of block.getStmts()) {
                const source = candidate.getOriginalText?.();
                if (!source || source === targetSource ||
                    !source.includes(targetSource) || !guardPattern.test(source)) {
                    continue;
                }
                if (!smallestEnclosing || source.length < smallestEnclosing.length) {
                    smallestEnclosing = source;
                }
            }
        }
        return smallestEnclosing !== null;
    }

    /** Recover truthiness guards around ArkUI's synthetic If nodes. */
    private isLexicallyContainedInTruthyGuard(
        stmt: Stmt,
        accessPath: NullnessAccessPath
    ): boolean {
        const targetSource = stmt.getOriginalText?.()?.trim();
        const cfg = stmt.getCfg();
        const canonical = this.canonicalAccessPath(accessPath, new Set());
        const rendered = canonical.toString().replace(/\s+/g, '');
        if (!targetSource || !cfg || !rendered || rendered.startsWith('%')) return false;
        const escaped = escapeRegExp(rendered).replace(/\\\./g, '\\s*\\.\\s*');
        const guardPattern = new RegExp(
            `\\bif\\s*\\(\\s*${escaped}(?:\\s*\\)|\\s*&&)`
        );
        for (const block of cfg.getBlocks()) {
            for (const candidate of block.getStmts()) {
                const source = candidate.getOriginalText?.();
                if (!source || source.trim() === targetSource ||
                    !source.includes(targetSource)) {
                    continue;
                }
                const header = stripCommentsAndLiterals(source).split('{', 1)[0];
                if (guardPattern.test(header)) return true;
            }
        }
        return false;
    }

    /**
     * ArkIR lowers a bare `${value}` interpolation to an implicit string
     * conversion call. That conversion accepts nullish values and is not a
     * source-level property, index or method dereference.
     */
    private isBareTemplateInterpolationCoercion(
        stmt: Stmt,
        accessPath: NullnessAccessPath
    ): boolean {
        const source = stmt.getOriginalText?.();
        if (!source || !source.includes('`') || !source.includes('${')) return false;
        const canonical = this.canonicalAccessPath(accessPath, new Set());
        if (!canonical.isLocal()) return false;
        const name = canonical.base?.getName();
        if (!name || name.startsWith('%')) return false;
        const escaped = escapeRegExp(name);
        const bareInterpolation = new RegExp(`\\$\\{\\s*${escaped}\\s*\\}`, 'g');
        if (!bareInterpolation.test(source)) return false;
        bareInterpolation.lastIndex = 0;
        const remainingSource = source.replace(bareInterpolation, '');
        // The same spelling may also occur as literal text (`value: ${value}`).
        // Reject suppression only when the source still contains a semantic
        // access through that identifier.
        const sourceDereference = new RegExp(
            `\\b${escaped}\\b\\s*(?:!(?!=)\\s*)?(?:\\.|\\[|\\()`
        );
        return !sourceDereference.test(remainingSource);
    }

    /** Suppress an abstract base-field default overwritten by every concrete constructor. */
    private isInitializedByEveryConcreteSubclass(
        stmt: Stmt,
        fact: NullnessFact
    ): boolean {
        const sourceStmt = fact.origin?.stmt;
        if (!(sourceStmt instanceof ArkAssignStmt)) return false;
        const sourceField = sourceStmt.getLeftOp();
        if (!(sourceField instanceof ArkInstanceFieldRef) ||
            !(sourceStmt.getRightOp() instanceof UndefinedConstant)) {
            return false;
        }
        const baseClass = sourceStmt.getCfg()?.getDeclaringMethod().getDeclaringArkClass();
        if (!baseClass?.containsModifier(ModifierType.ABSTRACT)) return false;
        const canonical = this.canonicalAccessPath(fact.accessPath, new Set());
        const fieldName = sourceField.getFieldSignature().getFieldName();
        if (canonical.fields.at(-1)?.getFieldName() !== fieldName) return false;

        const descendants: ArkClass[] = [];
        const workList = [...baseClass.getExtendedClasses().values()];
        const visited = new Set<ArkClass>();
        while (workList.length > 0) {
            const candidate = workList.pop()!;
            if (visited.has(candidate)) continue;
            visited.add(candidate);
            descendants.push(candidate);
            workList.push(...candidate.getExtendedClasses().values());
        }
        const concreteClasses = descendants.filter(candidate =>
            !candidate.containsModifier(ModifierType.ABSTRACT)
        );
        if (concreteClasses.length === 0) return false;
        return concreteClasses.every(candidate => {
            const constructor = candidate.getMethodWithName(CONSTRUCTOR_NAME);
            const startingBlock = constructor?.getCfg()?.getStartingBlock();
            if (!startingBlock) return false;
            return startingBlock.getStmts().some(candidateStmt => {
                if (!(candidateStmt instanceof ArkAssignStmt)) return false;
                const left = candidateStmt.getLeftOp();
                const right = candidateStmt.getRightOp();
                return left instanceof ArkInstanceFieldRef &&
                    left.getBase().toString() === 'this' &&
                    left.getFieldSignature().getFieldName() === fieldName &&
                    !(right instanceof NullConstant) &&
                    !(right instanceof UndefinedConstant);
            });
        });
    }

    /** Match an exact `this.field` access to an ArkUI `@Require` property. */
    private isRequiredComponentField(
        stmt: Stmt,
        accessPath: NullnessAccessPath
    ): boolean {
        const canonical = this.canonicalAccessPath(accessPath, new Set());
        if (canonical.base?.getName() !== 'this' || canonical.fields.length !== 1) {
            return false;
        }
        const declaringClass = stmt.getCfg()?.getDeclaringMethod().getDeclaringArkClass();
        if (!declaringClass?.hasComponentDecorator()) return false;
        const fieldName = canonical.fields[0].getFieldName();
        return declaringClass.getFieldWithName(fieldName)?.hasDecorator('Require') ?? false;
    }

    /** Trace an SSA temporary back to a getter-like call used as its root. */
    private getStableCallMethodName(
        accessPath: NullnessAccessPath,
        visited: Set<Local>
    ): string | null {
        const base = accessPath.base;
        if (!(base instanceof Local) || visited.has(base)) return null;
        visited.add(base);
        const declaringStmt = base.getDeclaringStmt();
        if (!(declaringStmt instanceof ArkAssignStmt)) return null;
        const invoke = declaringStmt.getInvokeExpr();
        if (invoke) {
            const rawMethodName = invoke.getMethodSignature()
                .getMethodSubSignature().getMethodName();
            const getterName = /^Get-(.+)$/.exec(rawMethodName)?.[1];
            return getterName ?? (/^(?:get|is|has|find|peek|resolve)/.test(rawMethodName)
                ? rawMethodName
                : null);
        }
        const rightPath = NullnessAccessPath.fromValue(declaringStmt.getRightOp());
        return rightPath.isEmpty()
            ? null
            : this.getStableCallMethodName(rightPath, visited);
    }

    private isOptionalChainStmt(stmt: Stmt): boolean {
        const originalText = typeof stmt.getOriginalText === 'function'
            ? stmt.getOriginalText()
            : undefined;
        return originalText !== undefined &&
            /\?\s*\./.test(stripCommentsAndLiterals(originalText));
    }

    private shouldReportDereference(stmt: Stmt, fact: NullnessFact): boolean {
        const syntax = this.getDereferenceSyntax(stmt);
        if (syntax === DereferenceSyntax.NonNullAssertion) return true;
        if (syntax === DereferenceSyntax.OptionalChain) return false;

        // Project implementations can contradict their declared return type
        // (for example a method declared as HtmlTag that explicitly returns
        // null). The compiler then accepts a plain dereference, so the concrete
        // body-derived nullable-return evidence must remain reportable.
        if (fact.origin?.kind === NullnessOriginKind.NullableReturn) return true;

        // ArkTS rejects a nullable receiver used by a plain dereference. For
        // source-backed .ets statements, reserve the NPD report for the
        // explicit `!` that bypasses this compiler check. Synthetic statements
        // and non-ArkTS inputs stay visible because their source syntax cannot
        // be used as a sound report filter.
        const filePath = this.getLocation(stmt).filePath;
        return syntax === DereferenceSyntax.SyntheticOrUnknown || !filePath.endsWith('.ets');
    }

    private getDereferenceSyntax(stmt: Stmt): DereferenceSyntax {
        const cached = this.dereferenceSyntaxCache.get(stmt);
        if (cached !== undefined) return cached;

        const originalText = typeof stmt.getOriginalText === 'function'
            ? stmt.getOriginalText()
            : undefined;
        let syntax = DereferenceSyntax.SyntheticOrUnknown;
        if (originalText) {
            const source = stripCommentsAndLiterals(originalText);
            // Prefer `!` when one source expression contains both `?.` and a
            // later assertion, e.g. `value?.field!.method()`.
            // TODO: use per-access source ranges if ArkIR exposes them; one
            // original expression may currently back several lowered accesses.
            if (/!(?!=)\s*(?:\.|\[|\()/.test(source)) {
                syntax = DereferenceSyntax.NonNullAssertion;
            } else if (/\?\s*\./.test(source)) {
                syntax = DereferenceSyntax.OptionalChain;
            } else {
                syntax = DereferenceSyntax.PlainDereference;
            }
        }
        this.dereferenceSyntaxCache.set(stmt, syntax);
        return syntax;
    }

    private getLocation(stmt: Stmt): NullnessSourceLocation {
        const position = stmt.getOriginPositionInfo();
        let filePath = 'unknown';
        try {
            filePath = stmt.getCfg()?.getDeclaringMethod().getDeclaringArkFile().getFilePath() ?? 'unknown';
        } catch {
            // Synthetic statements may not have a declaring file.
        }
        return {
            filePath,
            line: position?.getLineNo() ?? -1,
            col: position?.getColNo() ?? -1,
        };
    }

    private getThisLocal(method: ArkMethod): Local | null {
        const cfg = method.getCfg();
        if (!cfg) {
            return null;
        }
        for (const stmt of cfg.getStartingBlock()?.getStmts() ?? []) {
            const defined = stmt.getDef();
            if (defined instanceof Local && defined.getName() === 'this') {
                return defined;
            }
        }
        return null;
    }

    private getParameterLocal(method: ArkMethod, index: number): Local | null {
        const cfg = method.getCfg();
        if (!cfg) {
            return null;
        }
        for (const stmt of cfg.getStartingBlock()?.getStmts() ?? []) {
            if (!(stmt instanceof ArkAssignStmt)) {
                continue;
            }
            const parameterRef = stmt.getRightOp();
            const parameterLocal = stmt.getLeftOp();
            if (parameterRef instanceof ArkParameterRef &&
                parameterRef.getIndex() === index &&
                parameterLocal instanceof Local) {
                return parameterLocal;
            }
        }
        return null;
    }
}

enum DereferenceSyntax {
    NonNullAssertion,
    OptionalChain,
    PlainDereference,
    SyntheticOrUnknown,
}

function isFalsySentinel(value: Value): value is NumberConstant | StringConstant {
    return (value instanceof NumberConstant && value.getValue() === '0') ||
        (value instanceof StringConstant && value.getValue() === '');
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Remove text that could contain a non-null-looking `!` or optional chain. */
function stripCommentsAndLiterals(source: string): string {
    return source.replace(
        /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g,
        match => match.replace(/[^\r\n]/g, ' ')
    );
}
