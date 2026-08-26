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
 * @file taint/ResourceLeakDetector.ts
 * @description 资源泄漏检测器
 * 
 * 基于简化的方法内污点分析，检测 HarmonyOS 资源泄漏。
 * 
 * 检测策略：
 * 1. 扫描所有方法，识别资源申请点（Source）
 * 2. 追踪资源变量在方法内的使用
 * 3. 检查是否存在对应的释放点（Sink）
 * 4. 报告未释放的资源
 */

import {
    AbstractInvokeExpr,
    ArkAssignStmt,
    ArkClass,
    ArkInstanceFieldRef,
    ArkInstanceInvokeExpr,
    ArkInvokeStmt,
    ArkMethod,
    ArkStaticInvokeExpr,
    Local,
    Scene,
    Stmt,
    Value,
} from '../../adapter/arkanalyzer';

import { SourceSinkManager, MethodCallInfo } from './SourceSinkManager';
import { SourceDefinition, SinkDefinition } from './TaintFact';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 资源泄漏报告
 */
export interface ResourceLeakReport {
    /** 资源类型 */
    resourceType: string;
    /** 申请资源的方法 */
    sourceMethod: string;
    /** 所在类 */
    className: string;
    /** 所在方法 */
    methodName: string;
    /** 文件路径 */
    filePath: string;
    /** 行号 */
    lineNumber: number;
    /** 期望的释放方法 */
    expectedSink: string;
    /** 变量名 */
    variableName: string;
    /** 严重程度 */
    severity: 'error' | 'warning' | 'info';
    /** 描述 */
    description: string;
}

/**
 * 资源使用分析结果
 */
export interface ResourceUsageInfo {
    /** Source 定义 */
    source: SourceDefinition;
    /** 申请语句 */
    sourceStmt: Stmt;
    /** 存储资源的变量 */
    variable: Local;
    /** 是否已释放 */
    released: boolean;
    /** 释放语句（如果有） */
    sinkStmt?: Stmt;
}

/**
 * 检测配置
 */
export interface DetectorConfig {
    /** 是否检查所有方法（包括私有方法） */
    checkAllMethods?: boolean;
    /** 是否追踪字段赋值 */
    trackFieldAssignment?: boolean;
    /** 是否报告可能的泄漏（不确定的情况） */
    reportPossibleLeaks?: boolean;
    /** 自定义 SourceSinkManager */
    sourceSinkManager?: SourceSinkManager;
}

// ============================================================================
// ResourceLeakDetector
// ============================================================================

/**
 * 资源泄漏检测器
 * 
 * 对 HarmonyOS 项目进行静态分析，检测资源泄漏问题。
 */
export class ResourceLeakDetector {
    private scene: Scene;
    private sourceSinkManager: SourceSinkManager;
    private config: Required<DetectorConfig>;
    
    /** 检测到的泄漏 */
    private leaks: ResourceLeakReport[] = [];
    
    /** 分析过的方法数 */
    private analyzedMethodCount: number = 0;
    
    /** 发现的 Source 数 */
    private sourceCount: number = 0;
    
    /** 发现的 Sink 数 */
    private sinkCount: number = 0;
    
    constructor(scene: Scene, config?: DetectorConfig) {
        this.scene = scene;
        this.sourceSinkManager = config?.sourceSinkManager ?? new SourceSinkManager();
        this.config = {
            checkAllMethods: config?.checkAllMethods ?? true,
            trackFieldAssignment: config?.trackFieldAssignment ?? true,
            reportPossibleLeaks: config?.reportPossibleLeaks ?? true,
            sourceSinkManager: this.sourceSinkManager,
        };
    }
    
    /**
     * 执行检测
     */
    detect(): ResourceLeakReport[] {
        this.leaks = [];
        this.analyzedMethodCount = 0;
        this.sourceCount = 0;
        this.sinkCount = 0;
        
        // 遍历所有类
        for (const arkClass of this.scene.getClasses()) {
            this.analyzeClass(arkClass);
        }
        
        return this.leaks;
    }
    
    /**
     * 分析单个类
     */
    private analyzeClass(arkClass: ArkClass): void {
        const methods = arkClass.getMethods();
        
        for (const method of methods) {
            this.analyzeMethod(method);
        }
    }
    
    /**
     * 分析单个方法
     */
    private analyzeMethod(method: ArkMethod): void {
        const cfg = method.getCfg();
        if (!cfg) return;
        
        this.analyzedMethodCount++;
        
        const stmts = cfg.getStmts();
        
        // 收集方法内的资源使用情况
        const resourceUsages: ResourceUsageInfo[] = [];
        
        // 第一遍：识别 Source（资源申请）
        for (const stmt of stmts) {
            const sourceInfo = this.checkForSource(stmt);
            if (sourceInfo) {
                resourceUsages.push(sourceInfo);
                this.sourceCount++;
            }
        }
        
        // 如果没有资源申请，直接返回
        if (resourceUsages.length === 0) {
            return;
        }
        
        // 第二遍：检查 Sink（资源释放）
        for (const stmt of stmts) {
            this.checkForSink(stmt, resourceUsages);
        }
        
        // 报告未释放的资源
        for (const usage of resourceUsages) {
            if (!usage.released) {
                this.reportLeak(usage, method);
            }
        }
    }
    
    /**
     * 检查语句是否是 Source（资源申请）
     */
    private checkForSource(stmt: Stmt): ResourceUsageInfo | null {
        // 只检查赋值语句
        if (!(stmt instanceof ArkAssignStmt)) {
            return null;
        }
        
        const leftOp = stmt.getLeftOp();
        const rightOp = stmt.getRightOp();
        
        // 检查右值是否是方法调用
        const invokeExpr = this.getInvokeExpr(rightOp);
        if (!invokeExpr) {
            return null;
        }
        
        // 检查是否是 Source
        const callInfo = this.extractCallInfo(invokeExpr);
        const sourceDef = this.sourceSinkManager.isSource(callInfo);
        
        if (sourceDef && sourceDef.returnTainted) {
            // 获取存储资源的变量
            if (leftOp instanceof Local) {
                return {
                    source: sourceDef,
                    sourceStmt: stmt,
                    variable: leftOp,
                    released: false,
                };
            }
            
            // 如果赋值给字段，也追踪
            if (this.config.trackFieldAssignment && leftOp instanceof ArkInstanceFieldRef) {
                // 对于字段赋值，创建一个虚拟的 Local 来追踪
                // 实际上这需要更复杂的别名分析
                // 暂时简化处理
            }
        }
        
        return null;
    }
    
    /**
     * 检查语句是否是 Sink（资源释放）
     */
    private checkForSink(stmt: Stmt, resourceUsages: ResourceUsageInfo[]): void {
        // 检查调用语句
        let invokeExpr: AbstractInvokeExpr | null = null;
        
        if (stmt instanceof ArkInvokeStmt) {
            invokeExpr = stmt.getInvokeExpr();
        } else if (stmt instanceof ArkAssignStmt) {
            invokeExpr = this.getInvokeExpr(stmt.getRightOp());
        }
        
        if (!invokeExpr) {
            return;
        }
        
        // 检查是否是 Sink
        const callInfo = this.extractCallInfo(invokeExpr);
        const sinkDef = this.sourceSinkManager.isSink(callInfo);
        
        if (!sinkDef) {
            return;
        }
        
        this.sinkCount++;
        
        // 检查 Sink 是否释放了我们追踪的资源
        if (sinkDef.requireTaintedThis && invokeExpr instanceof ArkInstanceInvokeExpr) {
            const base = invokeExpr.getBase();
            
            // 查找匹配的资源
            for (const usage of resourceUsages) {
                if (this.variablesMatch(usage.variable, base)) {
                    // 检查 Source 和 Sink 是否配对
                    if (this.isMatchingPair(usage.source, sinkDef)) {
                        usage.released = true;
                        usage.sinkStmt = stmt;
                    }
                }
            }
        }
        
        // 检查参数是否是被追踪的资源
        const args = invokeExpr.getArgs();
        for (let i = 0; i < args.length; i++) {
            if (sinkDef.requiredTaintedParamIndices.includes(i)) {
                const arg = args[i];
                
                for (const usage of resourceUsages) {
                    if (this.variablesMatch(usage.variable, arg)) {
                        if (this.isMatchingPair(usage.source, sinkDef)) {
                            usage.released = true;
                            usage.sinkStmt = stmt;
                        }
                    }
                }
            }
        }
    }
    
    /**
     * 检查 Source 和 Sink 是否配对
     */
    private isMatchingPair(source: SourceDefinition, sink: SinkDefinition): boolean {
        // 通过 ID 匹配
        if (source.pairedSinkId === sink.id) {
            return true;
        }
        if (sink.pairedSourceId === source.id) {
            return true;
        }
        
        // 通过资源类型匹配
        // 例如：AVPlayer 的 create 和 release
        const sourceType = source.resourceType;
        if (sourceType && sink.methodPattern.includes(sourceType)) {
            return true;
        }
        
        return false;
    }
    
    /**
     * 检查两个变量是否匹配
     */
    private variablesMatch(local: Local, value: Value): boolean {
        if (value instanceof Local) {
            return local.getName() === value.getName();
        }
        return false;
    }
    
    /**
     * 从值中提取调用表达式
     */
    private getInvokeExpr(value: Value): AbstractInvokeExpr | null {
        if (value instanceof ArkInstanceInvokeExpr || value instanceof ArkStaticInvokeExpr) {
            return value;
        }
        return null;
    }
    
    /**
     * 提取方法调用信息
     */
    private extractCallInfo(invokeExpr: AbstractInvokeExpr): MethodCallInfo {
        const methodSig = invokeExpr.getMethodSignature();
        const className = methodSig.getDeclaringClassSignature().getClassName();
        const methodName = methodSig.getMethodSubSignature().getMethodName();
        
        return {
            className,
            methodName,
            fullSignature: methodSig.toString(),
        };
    }
    
    /**
     * 报告资源泄漏
     */
    private reportLeak(usage: ResourceUsageInfo, method: ArkMethod): void {
        const arkClass = method.getDeclaringArkClass();
        const arkFile = arkClass.getDeclaringArkFile();
        
        const pairedSink = this.sourceSinkManager.getPairedSink(usage.source);
        
        // 获取行号
        let lineNumber = 0;
        const posInfo = usage.sourceStmt.getOriginPositionInfo();
        if (posInfo) {
            lineNumber = posInfo.getLineNo();
        }
        
        const leak: ResourceLeakReport = {
            resourceType: usage.source.resourceType || 'unknown',
            sourceMethod: usage.source.methodPattern,
            className: arkClass.getName(),
            methodName: method.getName(),
            filePath: arkFile?.getName() || 'unknown',
            lineNumber,
            expectedSink: pairedSink?.methodPattern || 'unknown',
            variableName: usage.variable.getName(),
            severity: 'error',
            description: `资源 ${usage.source.resourceType || '未知类型'} 在方法 ${method.getName()} 中申请后未被释放。` +
                `变量 '${usage.variable.getName()}' 应在使用完毕后调用 ${pairedSink?.methodPattern || '对应释放方法'} 进行释放。`,
        };
        
        this.leaks.push(leak);
    }
    
    // ========================================================================
    // 统计信息
    // ========================================================================
    
    /**
     * 获取分析过的方法数
     */
    getAnalyzedMethodCount(): number {
        return this.analyzedMethodCount;
    }
    
    /**
     * 获取发现的 Source 数
     */
    getSourceCount(): number {
        return this.sourceCount;
    }
    
    /**
     * 获取发现的 Sink 数
     */
    getSinkCount(): number {
        return this.sinkCount;
    }
    
    /**
     * 获取检测到的泄漏
     */
    getLeaks(): ResourceLeakReport[] {
        return this.leaks;
    }
    
    /**
     * 获取 SourceSinkManager
     */
    getSourceSinkManager(): SourceSinkManager {
        return this.sourceSinkManager;
    }
}

// ============================================================================
// 导出
// ============================================================================

export default ResourceLeakDetector;
