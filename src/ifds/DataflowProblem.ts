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

import type { ArkMethod, Stmt } from '../adapter/arkanalyzer';

export abstract class DataflowProblem<D> {
    abstract getNormalFlowFunction(srcStmt: Stmt, tgtStmt: Stmt): FlowFunction<D>;

    abstract getCallFlowFunction(srcStmt: Stmt, method: ArkMethod): FlowFunction<D>;

    abstract getExitToReturnFlowFunction(srcStmt: Stmt, tgtStmt: Stmt, callStmt: Stmt): FlowFunction<D>;

    abstract getCallToReturnFlowFunction(srcStmt: Stmt, tgtStmt: Stmt, callees?: ReadonlySet<ArkMethod>): FlowFunction<D>;

    /** Transfer facts from a throwing statement to a handler in the same method. */
    getExceptionalFlowFunction(_srcStmt: Stmt, _handlerStmt: Stmt): FlowFunction<D> {
        return this.identityFlowFunction();
    }

    /** Preserve caller-owned facts when a call completes exceptionally. */
    getCallToExceptionalReturnFlowFunction(
        _srcStmt: Stmt,
        _handlerStmt: Stmt,
        _callees?: ReadonlySet<ArkMethod>
    ): FlowFunction<D> {
        return this.identityFlowFunction();
    }

    /** Map an exceptional callee exit, including its payload, into a caller handler. */
    getExceptionalExitToReturnFlowFunction(
        _exitStmt: Stmt,
        _handlerStmt: Stmt,
        _callStmt: Stmt
    ): FlowFunction<D> {
        return this.identityFlowFunction();
    }

    abstract createZeroValue(): D;

    abstract getEntryPoint(): Stmt;

    abstract getEntryMethod(): ArkMethod;

    abstract factEqual(d1: D, d2: D): boolean;

    /**
     * Return a stable semantic hash for one fact. Equal facts must have the same
     * hash. The constant fallback preserves correctness for existing problems,
     * but places every fact in the same collision bucket.
     */
    factHash(_fact: D): number {
        return 0;
    }

    private identityFlowFunction(): FlowFunction<D> {
        return {
            getDataFacts(fact: D): Set<D> {
                return new Set([fact]);
            },
        };
    }
}

export interface FlowFunction<D> {
    getDataFacts(d: D): Set<D>;
}
