/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import { ArkAssignStmt, Stmt } from '../../../adapter/arkanalyzer';
import { NullConstant, UndefinedConstant } from '../../../adapter/arkanalyzer';
import {
    NullnessAccessPath,
    NullnessFact,
    NullnessKind,
    NullnessOriginKind,
} from '../NullnessFact';
import { NullnessLibrarySummary } from './NullnessLibrarySummary';

const ASYNC_METHODS = new Set([
    'addEventListener', 'catch', 'finally', 'on', 'once', 'setInterval', 'setTimeout',
    'resolve', 'then', 'toPromise',
]);

/** Conservative boundary for Promise chains and callback registration APIs. */
export class AsyncBoundarySummary implements NullnessLibrarySummary {
    readonly id = 'async-boundary';

    matches(callStmt: Stmt): boolean {
        const invoke = callStmt.getInvokeExpr();
        if (!invoke) return false;
        const method = invoke.getMethodSignature();
        const methodName = method.getMethodSubSignature().getMethodName();
        if (!ASYNC_METHODS.has(methodName)) return false;
        const fileName = method.getDeclaringClassSignature().getDeclaringFileSignature().getFileName();
        return fileName === '%unk' || fileName.endsWith('.d.ts') || fileName.endsWith('.d.ets');
    }

    getCallToReturnFacts(callStmt: Stmt, inputFact: NullnessFact): Set<NullnessFact> {
        if (!(callStmt instanceof ArkAssignStmt)) {
            return new Set();
        }
        const invoke = callStmt.getInvokeExpr();
        if (!invoke || invoke.getMethodSignature().getMethodSubSignature().getMethodName() !== 'resolve') {
            // Promise/callback boundary calls return non-null handles. Their
            // payload effects are modeled through call/exit flow, not by
            // marking the handle itself MaybeNullish.
            return new Set();
        }
        const callTargetPath = NullnessAccessPath.fromValue(callStmt.getLeftOp());
        if (callTargetPath.isEmpty()) return new Set();
        const resultPath = callTargetPath.appendPromisePayload();
        const argument = invoke.getArgs()[0];
        if (inputFact.isZeroFact()) {
            const kind = argument instanceof NullConstant
                ? NullnessKind.Null
                : argument instanceof UndefinedConstant
                    ? NullnessKind.Undefined
                    : null;
            return kind ? new Set([NullnessFact.create(resultPath, kind, {
                kind: NullnessOriginKind.LibraryModel,
                stmt: callStmt,
                description: 'Promise.resolve payload',
            })]) : new Set();
        }

        const argumentPath = NullnessAccessPath.fromValue(argument);
        if (argumentPath.isEmpty() || !argumentPath.isPrefixOf(inputFact.accessPath)) {
            return new Set();
        }
        const remainingFields = inputFact.accessPath.remainingFieldsAfter(argumentPath);
        return new Set([inputFact.deriveWithNewAccessPath(
            new NullnessAccessPath(
                resultPath.base,
                resultPath.baseType,
                [...resultPath.fields, ...remainingFields]
            ),
            callStmt
        )]);
    }
}
