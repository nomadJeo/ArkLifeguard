/*
 * Copyright (c) 2024-2025 Huawei Device Co., Ltd.
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
    ArkInvokeStmt,
    ArkMethod,
    FunctionType,
} from '../adapter/arkanalyzer';

export function getRecallMethodInParam(stmt: ArkInvokeStmt): ArkMethod | null {
    for (const param of stmt.getInvokeExpr().getArgs()) {
        const paramType = param.getType();
        if (paramType instanceof FunctionType) {
            const methodSignature = paramType.getMethodSignature();
            const method = stmt.getCfg()?.getDeclaringMethod()
                .getDeclaringArkClass().getMethod(methodSignature);
            if (method) {
                return method;
            }
        }
    }
    return null;
}
