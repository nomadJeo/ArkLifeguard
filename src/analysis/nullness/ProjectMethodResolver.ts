/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import type { Scene } from '../../adapter/arkanalyzer';
import { ArkStaticInvokeExpr } from '../../adapter/arkanalyzer';
import { Stmt } from '../../adapter/arkanalyzer';
import { ModelUtils } from '../../adapter/arkanalyzer';
import { ArkMethod } from '../../adapter/arkanalyzer';

/**
 * Resolve project methods which ArkAnalyzer leaves under the `%unk` signature.
 * This is common for imported top-level functions: the import/export model knows
 * the target even when the invoke expression has not been rewritten yet.
 */
export function resolveProjectMethods(scene: Scene, callStmt: Stmt): Set<ArkMethod> {
    const invoke = callStmt.getInvokeExpr();
    if (!invoke) return new Set();

    const result = new Set<ArkMethod>();
    const signature = invoke.getMethodSignature();
    const declaringFile = signature.getDeclaringClassSignature().getDeclaringFileSignature();
    const directMethod = scene.getFile(declaringFile) ? scene.getMethod(signature) : null;
    if (directMethod?.getCfg()) {
        result.add(directMethod);
    }
    if (result.size > 0 || !(invoke instanceof ArkStaticInvokeExpr)) {
        return result;
    }

    const callerFile = callStmt.getCfg()?.getDeclaringMethod().getDeclaringArkFile();
    if (!callerFile) return result;

    const methodName = invoke.getMethodSignature().getMethodSubSignature().getMethodName();
    const sameFileMethod = ModelUtils.getStaticMethodInFileWithName(methodName, callerFile);
    if (sameFileMethod?.getCfg()) {
        result.add(sameFileMethod);
    }

    const importedMethod = ModelUtils.getStaticMethodInImportInfoWithName(methodName, callerFile);
    if (importedMethod?.getCfg()) {
        result.add(importedMethod);
    }
    return result;
}
