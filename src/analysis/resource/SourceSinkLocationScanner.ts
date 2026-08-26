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

/**
 * @file taint/SourceSinkLocationScanner.ts
 * @description Source/Sink 位置扫描器
 *
 * 遍历 Scene 中所有方法调用，识别 Source/Sink 并提取位置信息（文件路径、行号、列号）。
 * 用于 Web 可视化展示 Source/Sink 列表与定位。
 */

import {
    ArkAssignStmt,
    ArkInstanceInvokeExpr,
    ArkInvokeStmt,
    ArkMethod,
    ArkStaticInvokeExpr,
    Scene,
    Stmt,
} from '../../adapter/arkanalyzer';
import { SourceSinkManager, MethodCallInfo } from './SourceSinkManager';

// ============================================================================
// 类型定义
// ============================================================================

export interface SourceLocation {
    type: 'source';
    resourceType: string;
    methodPattern: string;
    methodSig: string;
    filePath: string;
    line: number;
    col: number;
}

export interface SinkLocation {
    type: 'sink';
    resourceType: string;
    methodPattern: string;
    methodSig: string;
    filePath: string;
    line: number;
    col: number;
}

export type SourceSinkLocation = SourceLocation | SinkLocation;

// ============================================================================
// SourceSinkLocationScanner
// ============================================================================

export class SourceSinkLocationScanner {
    private scene: Scene;
    private sourceSinkManager: SourceSinkManager;

    constructor(scene: Scene, sourceSinkManager?: SourceSinkManager) {
        this.scene = scene;
        this.sourceSinkManager = sourceSinkManager ?? new SourceSinkManager();
    }

    /**
     * 扫描 Scene 中所有 Source 和 Sink 调用，返回位置列表
     */
    scan(): { sources: SourceLocation[]; sinks: SinkLocation[] } {
        const sources: SourceLocation[] = [];
        const sinks: SinkLocation[] = [];

        for (const method of this.scene.getMethods()) {
            const cfg = method.getCfg();
            if (!cfg) continue;

            for (const block of cfg.getBlocks()) {
                for (const stmt of block.getStmts()) {
                    const invokeExpr = this.getInvokeExprFromStmt(stmt);
                    if (!invokeExpr) continue;

                    const methodSig = invokeExpr.getMethodSignature();
                    const className = methodSig.getDeclaringClassSignature().getClassName();
                    const methodName = methodSig.getMethodSubSignature().getMethodName();
                    const callInfo: MethodCallInfo = {
                        className,
                        methodName,
                        fullSignature: methodSig.toString(),
                    };

                    const sourceDef = this.sourceSinkManager.isSource(callInfo);
                    const sinkDef = this.sourceSinkManager.isSink(callInfo);

                    const { filePath, line, col } = this.getLocation(stmt, method);
                    const methodSigStr = methodSig.toString();

                    if (sourceDef) {
                        sources.push({
                            type: 'source',
                            resourceType: sourceDef.resourceType || 'unknown',
                            methodPattern: sourceDef.methodPattern,
                            methodSig: methodSigStr,
                            filePath,
                            line,
                            col,
                        });
                    }
                    if (sinkDef) {
                        const pairedSource = this.sourceSinkManager.getPairedSource(sinkDef);
                        sinks.push({
                            type: 'sink',
                            resourceType: pairedSource?.resourceType || sinkDef.methodPattern,
                            methodPattern: sinkDef.methodPattern,
                            methodSig: methodSigStr,
                            filePath,
                            line,
                            col,
                        });
                    }
                }
            }
        }

        return { sources, sinks };
    }

    private getInvokeExprFromStmt(stmt: Stmt): ArkInstanceInvokeExpr | ArkStaticInvokeExpr | null {
        if (stmt instanceof ArkInvokeStmt) {
            const expr = stmt.getInvokeExpr();
            return this.isInvokeExpr(expr) ? expr : null;
        }
        if (stmt instanceof ArkAssignStmt) {
            const rightOp = stmt.getRightOp();
            return this.isInvokeExpr(rightOp) ? rightOp : null;
        }
        return null;
    }

    private isInvokeExpr(value: unknown): value is ArkInstanceInvokeExpr | ArkStaticInvokeExpr {
        return value instanceof ArkInstanceInvokeExpr || value instanceof ArkStaticInvokeExpr;
    }

    /**
     * 根据 Stmt 查找其所属 Method 并返回位置信息（用于序列化 ResourceLeak/TaintLeak 等）
     */
    static getLocationForStmt(scene: Scene, stmt: Stmt): { filePath: string; line: number; col: number } {
        for (const method of scene.getMethods()) {
            const cfg = method.getCfg();
            if (!cfg) continue;
            for (const block of cfg.getBlocks()) {
                for (const s of block.getStmts()) {
                    if (s === stmt) {
                        return new SourceSinkLocationScanner(scene).getLocation(stmt, method);
                    }
                }
            }
        }
        return { filePath: 'unknown', line: 0, col: 0 };
    }

    private getLocation(stmt: Stmt, method: ArkMethod): { filePath: string; line: number; col: number } {
        let filePath = 'unknown';
        try {
            const arkFile = method.getDeclaringArkFile?.();
            if (arkFile?.getFilePath) {
                filePath = arkFile.getFilePath();
            }
        } catch {
            // ignore
        }

        let line = 0;
        let col = 0;
        try {
            const pos = stmt.getOriginPositionInfo?.();
            if (pos) {
                line = pos.getLineNo?.() ?? 0;
                col = pos.getColNo?.() ?? 0;
            }
        } catch {
            // ignore
        }

        return { filePath, line, col };
    }
}
