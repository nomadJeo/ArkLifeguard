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
    AliasType,
    ArkAssignStmt,
    ArkCastExpr,
    ArkMethod,
    ArkParameterRef,
    ArkPtrInvokeExpr,
    ArkStaticInvokeExpr,
    FunctionType,
    Local,
    ModelUtils,
    Scene,
    Stmt,
    Type,
    UnionType,
    Value,
} from '../adapter/arkanalyzer';

/** @deprecated The solver uses CallResolver; this legacy API returns only one method. */
export function getRecallMethodInParam(stmt: Stmt): ArkMethod | null {
    for (const param of stmt.getInvokeExpr()?.getArgs() ?? []) {
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

/** Resolve imported/top-level functions left under an unresolved IR signature. */
export function resolveProjectMethods(scene: Scene, call: Stmt): Set<ArkMethod> {
    const invoke = call.getInvokeExpr();
    const result = new Set<ArkMethod>();
    if (!invoke) return result;
    const signature = invoke.getMethodSignature();
    const file = signature.getDeclaringClassSignature().getDeclaringFileSignature();
    const direct = scene.getFile(file) ? scene.getMethod(signature) : null;
    if (direct?.getCfg()) result.add(direct);
    if (result.size || !(invoke instanceof ArkStaticInvokeExpr)) return result;
    // Never resolve an SDK method by an unrelated same-name project function.
    if (scene.hasSdkFile(file)) return result;
    const callerFile = call.getCfg()?.getDeclaringMethod().getDeclaringArkFile();
    if (!callerFile) return result;
    const name = signature.getMethodSubSignature().getMethodName();
    for (const method of [
        ModelUtils.getStaticMethodInFileWithName(name, callerFile),
        ModelUtils.getStaticMethodInImportInfoWithName(name, callerFile),
    ]) {
        if (method?.getCfg()) result.add(method);
    }
    return result;
}

interface ParameterUse {
    invoked: Set<number>;
    dependencies: Array<{ callee: ArkMethod; arguments: Set<number>[] }>;
}

/**
 * HapFlow Definition 3.1 / Algorithm 1: expression targets plus invoked callback
 * arguments. Summaries propagate parameter uses through project wrappers to a
 * finite fixed point, including recursive forwarding (as in HomeFlow's bindings).
 * This is a may-call analysis, not an asynchronous scheduling model or a PTA.
 */
export class CallResolver {
    private readonly callees = new Map<Stmt, Set<ArkMethod>>();
    private readonly expressions = new Map<Stmt, Set<ArkMethod>>();
    private readonly definitions = new Map<ArkMethod, Map<Value, Value[]>>();
    private readonly parameterUses = new Map<ArkMethod, ParameterUse>();
    private readonly settled = new Set<ArkMethod>();

    constructor(
        private readonly scene: Scene,
        private readonly resolveExpression: (call: Stmt) => Set<ArkMethod>,
    ) {}

    getCallees(call: Stmt): Set<ArkMethod> {
        const cached = this.callees.get(call);
        if (cached) return cached;
        const result = new Set(this.getExpressionCallees(call));
        const invoke = call.getInvokeExpr();
        if (invoke) {
            const callbacks = invoke.getArgs().map(argument => this.valueToMethods(argument, call));
            // Ordinary calls do not need a callback-use summary of their bodies.
            if (callbacks.some(methods => methods.size > 0)) {
                const indices = this.invokedArguments(call);
                callbacks.forEach((methods, index) => {
                    if (!indices.has(index)) return;
                    for (const method of methods) result.add(method);
                });
            }
        }
        this.callees.set(call, result);
        return result;
    }

    private getExpressionCallees(call: Stmt): Set<ArkMethod> {
        const cached = this.expressions.get(call);
        if (cached) return cached;
        const invoke = call.getInvokeExpr();
        const result = invoke instanceof ArkPtrInvokeExpr
            ? this.valueToMethods(invoke.getFuncPtrLocal(), call)
            : this.resolveExpression(call);
        this.expressions.set(call, result);
        return result;
    }

    private invokedArguments(call: Stmt): Set<number> {
        const targets = this.getExpressionCallees(call);
        if (targets.size === 0) {
            // Unavailable SDK/library bodies: retain every callback argument.
            // A project parameter invocation is not an SDK registration.
            const invoke = call.getInvokeExpr();
            if (invoke instanceof ArkPtrInvokeExpr &&
                this.parameterOrigins(invoke.getFuncPtrLocal(), call).size > 0) return new Set();
            return new Set(invoke?.getArgs().map((_, index) => index));
        }
        this.solveParameterUses(targets);
        const result = new Set<number>();
        for (const target of targets) {
            for (const index of this.parameterUses.get(target)!.invoked) result.add(index);
        }
        return result;
    }

    private solveParameterUses(roots: Set<ArkMethod>): void {
        const pending = [...roots].filter(method => !this.settled.has(method));
        if (pending.length === 0) return;
        const methods = new Set<ArkMethod>();
        for (let i = 0; i < pending.length; i++) {
            const method = pending[i];
            if (methods.has(method) || this.settled.has(method)) continue;
            methods.add(method);
            const summary = this.buildParameterUse(method);
            this.parameterUses.set(method, summary);
            for (const dependency of summary.dependencies) pending.push(dependency.callee);
        }
        // All sets range over finite parameter positions. Do not cache a partial
        // recursive summary as final: a use may arrive through another wrapper.
        let changed: boolean;
        do {
            changed = false;
            for (const method of methods) {
                const summary = this.parameterUses.get(method)!;
                for (const dependency of summary.dependencies) {
                    for (const index of this.parameterUses.get(dependency.callee)!.invoked) {
                        for (const origin of dependency.arguments[index] ?? []) {
                            if (summary.invoked.has(origin)) continue;
                            summary.invoked.add(origin);
                            changed = true;
                        }
                    }
                }
            }
        } while (changed);
        for (const method of methods) this.settled.add(method);
    }

    private buildParameterUse(method: ArkMethod): ParameterUse {
        const summary: ParameterUse = { invoked: new Set(), dependencies: [] };
        for (const stmt of method.getCfg()?.getStmts() ?? []) {
            const invoke = stmt.getInvokeExpr();
            if (!invoke) continue;
            if (invoke instanceof ArkPtrInvokeExpr) {
                for (const index of this.parameterOrigins(invoke.getFuncPtrLocal(), stmt)) {
                    summary.invoked.add(index);
                }
            }
            const origins = invoke.getArgs().map(argument => this.parameterOrigins(argument, stmt));
            if (origins.every(indices => indices.size === 0)) continue;
            const callees = this.getExpressionCallees(stmt);
            if (callees.size === 0) {
                // A passed callback may be executed by an unavailable body,
                // including an unknown function-valued formal parameter.
                for (const indices of origins) for (const index of indices) summary.invoked.add(index);
            } else {
                for (const callee of callees) summary.dependencies.push({ callee, arguments: origins });
            }
        }
        return summary;
    }

    private valueToMethods(value: Value, call: Stmt): Set<ArkMethod> {
        const result = new Set<ArkMethod>();
        this.walkAliases(value, call, candidate => {
            this.walkFunctionTypes(candidate.getType(), new Set(), type => {
                const signature = type.getMethodSignature();
                const file = signature.getDeclaringClassSignature().getDeclaringFileSignature();
                const method = this.scene.getFile(file) ? this.scene.getMethod(signature) : null;
                if (method?.getCfg()) result.add(method);
            });
        });
        return result;
    }

    private walkFunctionTypes(type: Type, seen: Set<Type>, visit: (type: FunctionType) => void): void {
        if (seen.has(type)) return;
        seen.add(type);
        if (type instanceof FunctionType) visit(type);
        else if (type instanceof AliasType) this.walkFunctionTypes(type.getOriginalType(), seen, visit);
        else if (type instanceof UnionType) {
            for (const member of type.getTypes()) this.walkFunctionTypes(member, seen, visit);
        }
    }

    private parameterOrigins(value: Value, call: Stmt): Set<number> {
        const result = new Set<number>();
        this.walkAliases(value, call, candidate => {
            if (candidate instanceof ArkParameterRef) result.add(candidate.getIndex());
        });
        return result;
    }

    private walkAliases(value: Value, call: Stmt, visit: (value: Value) => void): void {
        const owner = call.getCfg()?.getDeclaringMethod();
        const definitions = owner ? this.getDefinitions(owner) : undefined;
        const pending = [value];
        const seen = new Set<Value>();
        while (pending.length) {
            const candidate = pending.pop()!;
            if (seen.has(candidate)) continue;
            seen.add(candidate);
            visit(candidate);
            if (candidate instanceof ArkCastExpr) pending.push(candidate.getOp());
            if (!(candidate instanceof Local)) continue;
            for (const source of definitions?.get(candidate) ?? []) pending.push(source);
            const declaration = candidate.getDeclaringStmt();
            if (declaration instanceof ArkAssignStmt) pending.push(declaration.getRightOp());
        }
    }

    private getDefinitions(method: ArkMethod): Map<Value, Value[]> {
        const cached = this.definitions.get(method);
        if (cached) return cached;
        const definitions = new Map<Value, Value[]>();
        for (const stmt of method.getCfg()?.getStmts() ?? []) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const target = stmt.getLeftOp();
            const sources = definitions.get(target) ?? [];
            sources.push(stmt.getRightOp());
            definitions.set(target, sources);
        }
        this.definitions.set(method, definitions);
        return definitions;
    }
}
