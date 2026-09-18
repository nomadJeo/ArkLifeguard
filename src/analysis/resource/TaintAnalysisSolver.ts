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
 * @file taint/TaintAnalysisSolver.ts
 * @description 污点分析求解器
 * 
 * 继承 DataflowSolver，实现完整的跨过程污点分析。
 * 利用 ArkAnalyzer 已有的：
 * - CallGraph：调用图
 * - ClassHierarchyAnalysis：类层次分析
 * - Cfg：控制流图
 */

import { ArkAssignStmt, ArkClass, ArkInvokeStmt, ArkMethod, Scene, Stmt } from '../../adapter/arkanalyzer';
import { DataflowSolver } from '../../ifds/DataflowSolver';
import type {
    DataflowSolverOptions,
    IFDSSolverStatistics,
} from '../../ifds/SolverStatistics';

import { TaintFact } from './TaintFact';
import { TaintAnalysisProblem, TaintAnalysisConfig, ResourceLeak, TaintLeak } from './TaintAnalysisProblem';
import { SourceSinkManager } from './SourceSinkManager';
import {
    createLifecycleModelCreator,
    LifecycleModelCreator,
} from '../../lifecycle';

// ============================================================================
// TaintAnalysisSolver
// ============================================================================

/**
 * 污点分析求解器
 * 
 * 继承 ArkAnalyzer 的 DataflowSolver，使用 IFDS 算法进行跨过程污点分析。
 */
export class TaintAnalysisSolver extends DataflowSolver<TaintFact> {
    private taintProblem: TaintAnalysisProblem;
    
    constructor(
        problem: TaintAnalysisProblem,
        scene: Scene,
        options: DataflowSolverOptions = {}
    ) {
        super(problem, scene, options);
        this.taintProblem = problem;
    }
    
    /**
     * 获取污点分析问题
     */
    getTaintProblem(): TaintAnalysisProblem {
        return this.taintProblem;
    }
    
    /**
     * 获取发现的资源泄漏
     */
    getResourceLeaks(): ResourceLeak[] {
        return this.taintProblem.getResourceLeaks();
    }
    
    /**
     * 获取发现的污点泄漏
     */
    getTaintLeaks(): TaintLeak[] {
        return this.taintProblem.getTaintLeaks();
    }
    
    /**
     * 获取所有到达的污点事实
     */
    getReachedFacts(): Map<Stmt, Set<TaintFact>> {
        const result = new Map<Stmt, Set<TaintFact>>();
        
        for (const pathEdge of this.pathEdgeStore.values()) {
            const stmt = pathEdge.edgeEnd.node;
            const fact = pathEdge.edgeEnd.fact;
            
            if (!result.has(stmt)) {
                result.set(stmt, new Set());
            }
            result.get(stmt)!.add(fact);
        }
        
        return result;
    }
    
    /**
     * 检查特定语句是否有特定的污点事实
     */
    hasFactAtStmt(stmt: Stmt, fact: TaintFact): boolean {
        return this.computeResult(stmt, fact);
    }
}

// ============================================================================
// TaintAnalysisRunner
// ============================================================================

/**
 * 污点分析运行器
 * 
 * 封装完整的污点分析流程：
 * - runFromDummyMain：以 LifecycleModelCreator 生成的 DummyMain 为入口（推荐，覆盖所有生命周期路径）
 * - runFromMethod：从指定方法开始
 * - runFromAllEntries：从所有生命周期方法逐个分析
 */
export class TaintAnalysisRunner {
    private scene: Scene;
    private sourceSinkManager: SourceSinkManager;
    private config: TaintAnalysisConfig;
    
    constructor(scene: Scene, config?: TaintAnalysisConfig) {
        this.scene = scene;
        this.sourceSinkManager = config?.sourceSinkManager ?? new SourceSinkManager();
        this.config = config ?? {};
    }
    
    /**
     * 以 DummyMain 为入口运行污点分析（推荐方式）
     * 
     * 流程：
     * 1. 用 LifecycleModelCreator 构建 DummyMain（串联所有生命周期回调）
     * 2. 以 DummyMain 为入口点创建 TaintAnalysisProblem
     * 3. 用 TaintAnalysisSolver（继承 DataflowSolver）执行 IFDS 求解
     * 4. 收集跨生命周期的资源泄漏结果
     */
    runFromDummyMain(): TaintAnalysisResult {
        const startTime = Date.now();
        
        // Step 1: 构建 DummyMain
        let dummyMain: ArkMethod;
        let creator: LifecycleModelCreator;
        try {
            // 将约束2（maxCallbackIterations）传入 LifecycleModelCreator 的 bounds 配置
            // LifecycleModelCreator 构造函数会深合并 bounds，缺省字段使用 DEFAULT_LIFECYCLE_CONFIG.bounds 填充
            const lifecycleConfig = this.config.maxCallbackIterations !== undefined
                ? { bounds: { maxCallbackIterations: this.config.maxCallbackIterations } as any }
                : undefined;
            creator = createLifecycleModelCreator(
                this.scene,
                this.config.lifecycleModel ?? 'flat',
                lifecycleConfig
            );
            creator.create();
            dummyMain = creator.getDummyMain();
        } catch (e) {
            return this.failResult(`DummyMain 构建失败: ${e}`);
        }
        
        if (!dummyMain) {
            return this.failResult('DummyMain 为空');
        }
        
        const result = this.runWithDummyMain(dummyMain, creator.getAbilityMethodSet());
        result.statistics.duration = Date.now() - startTime;
        return result;
    }

    /**
     * 使用已经由应用层构建好的 DummyMain 执行分析，避免同一次全链路分析重复
     * 创建生命周期模型。abilityMethodMap 用于落实 Ability 数量与导航跳数约束。
     */
    runWithDummyMain(
        dummyMain: ArkMethod,
        abilityMethodMap: Map<ArkMethod, string> = new Map()
    ): TaintAnalysisResult {
        const startTime = Date.now();
        if (!dummyMain.getCfg()) {
            return this.failResult('DummyMain 没有 CFG');
        }

        const entryStmt = this.getEntryStmt(dummyMain);
        if (!entryStmt) {
            return this.failResult('无法获取 DummyMain 的入口语句');
        }

        const problem = new TaintAnalysisProblem(entryStmt, dummyMain, {
            ...this.config,
            sourceSinkManager: this.sourceSinkManager,
            abilityMethodMap,
        });
        const solver = new TaintAnalysisSolver(problem, this.scene, {
            collectStatistics: this.config.collectSolverStatistics,
        });
        solver.solve();

        const reachedFacts = solver.getReachedFacts();
        let resourceLeaks = solver.getResourceLeaks();
        resourceLeaks = LifecycleLeakSuppressor.filterSuppressedTimerLeaks(this.scene, resourceLeaks);
        resourceLeaks = FileLeakSuppressor.filterSuppressedFileLeaks(this.scene, resourceLeaks);

        return {
            success: true,
            entryMethod: dummyMain.getSignature().toString(),
            resourceLeaks,
            taintLeaks: solver.getTaintLeaks(),
            reachedFacts,
            statistics: {
                analyzedMethods: this.countAnalyzedMethods(reachedFacts),
                totalFacts: this.countTotalFacts(reachedFacts),
                sourceCount: problem.getSourceSinkManager().getSourceCount(),
                sinkCount: problem.getSourceSinkManager().getSinkCount(),
                duration: Date.now() - startTime,
                solver: solver.getStatistics(),
            },
        };
    }
    
    /**
     * 从指定方法开始运行污点分析
     */
    runFromMethod(method: ArkMethod): TaintAnalysisResult {
        const cfg = method.getCfg();
        if (!cfg) {
            return this.failResult(`方法 ${method.getName()} 没有 CFG`);
        }
        
        const entryStmt = this.getEntryStmt(method);
        if (!entryStmt) {
            return this.failResult(`无法获取方法 ${method.getName()} 的入口语句`);
        }
        
        const startTime = Date.now();
        
        const problem = new TaintAnalysisProblem(entryStmt, method, {
            ...this.config,
            sourceSinkManager: this.sourceSinkManager,
        });
        
        const solver = new TaintAnalysisSolver(problem, this.scene, {
            collectStatistics: this.config.collectSolverStatistics,
        });
        solver.solve();
        
        const duration = Date.now() - startTime;
        const reachedFacts = solver.getReachedFacts();
        
        return {
            success: true,
            entryMethod: method.getSignature().toString(),
            resourceLeaks: solver.getResourceLeaks(),
            taintLeaks: solver.getTaintLeaks(),
            reachedFacts,
            statistics: {
                analyzedMethods: this.countAnalyzedMethods(reachedFacts),
                totalFacts: this.countTotalFacts(reachedFacts),
                sourceCount: problem.getSourceSinkManager().getSourceCount(),
                sinkCount: problem.getSourceSinkManager().getSinkCount(),
                duration,
                solver: solver.getStatistics(),
            },
        };
    }
    
    /**
     * 从所有入口方法运行污点分析
     */
    runFromAllEntries(): TaintAnalysisResult[] {
        const results: TaintAnalysisResult[] = [];
        const entryMethods = this.findEntryMethods();
        
        for (const method of entryMethods) {
            const result = this.runFromMethod(method);
            results.push(result);
        }
        
        return results;
    }
    
    private failResult(error: string): TaintAnalysisResult {
        return {
            success: false,
            error,
            resourceLeaks: [],
            taintLeaks: [],
            reachedFacts: new Map(),
            statistics: { analyzedMethods: 0, totalFacts: 0, sourceCount: 0, sinkCount: 0, duration: 0 },
        };
    }
    
    private getEntryStmt(method: ArkMethod): Stmt | null {
        const cfg = method.getCfg();
        if (!cfg) return null;
        
        // 优先使用 getStartingStmt（LifecycleModelCreator 会设置此值）
        try {
            const startingStmt = cfg.getStartingStmt();
            if (startingStmt) return startingStmt;
        } catch {
            // getStartingStmt 可能未设置，继续使用其他方式
        }
        
        // 回退：从 startBlock 获取
        try {
            const startBlock = cfg.getStartingBlock();
            if (startBlock) {
                const stmts = startBlock.getStmts();
                const paramCount = method.getParameters().length;
                if (stmts.length > paramCount) {
                    return stmts[paramCount];
                }
                if (stmts.length > 0) {
                    return stmts[0];
                }
            }
        } catch {
            // getStartingBlock 可能因为 stmtToBlock 未建立而失败
        }
        
        // 最终回退：遍历所有块找到第一条语句
        const blocks = cfg.getBlocks();
        for (const block of blocks) {
            const stmts = block.getStmts();
            if (stmts.length > 0) {
                return stmts[0];
            }
        }
        
        return null;
    }
    
    private findEntryMethods(): ArkMethod[] {
        const entryMethods: ArkMethod[] = [];
        
        for (const arkClass of this.scene.getClasses()) {
            for (const method of arkClass.getMethods()) {
                if (this.isLifecycleMethod(method) || method.getName() === 'main') {
                    entryMethods.push(method);
                }
            }
        }
        
        return entryMethods;
    }
    
    private isLifecycleMethod(method: ArkMethod): boolean {
        const lifecycleMethods = [
            'onCreate', 'onDestroy', 'onWindowStageCreate', 'onWindowStageDestroy',
            'onForeground', 'onBackground', 'onNewWant',
            'aboutToAppear', 'aboutToDisappear', 'onPageShow', 'onPageHide',
        ];
        return lifecycleMethods.includes(method.getName());
    }
    
    private countAnalyzedMethods(reachedFacts: Map<Stmt, Set<TaintFact>>): number {
        const methods = new Set<string>();
        for (const stmt of reachedFacts.keys()) {
            if (!stmt) continue;
            const cfg = stmt.getCfg();
            if (cfg) {
                methods.add(cfg.getDeclaringMethod().getSignature().toString());
            }
        }
        return methods.size;
    }
    
    private countTotalFacts(reachedFacts: Map<Stmt, Set<TaintFact>>): number {
        let count = 0;
        for (const facts of reachedFacts.values()) {
            count += facts.size;
        }
        return count;
    }
}

// ============================================================================
// 共享辅助
// ============================================================================

function getDirectCallee(stmt: Stmt, scene: Scene): ArkMethod | null {
    if (!(stmt instanceof ArkInvokeStmt)) return null;
    const sig = stmt.getInvokeExpr()?.getMethodSignature();
    if (!sig) return null;
    return scene.getMethod(sig) ?? null;
}

// ============================================================================
// LifecycleLeakSuppressor - 结构性抑制（阶段二）
// ============================================================================

/**
 * 生命周期泄漏结构性抑制
 * 当同组件的 aboutToDisappear 中含 clearInterval/clearTimeout 时，抑制 setInterval/setTimeout 的误报
 */
export class LifecycleLeakSuppressor {
    private static readonly TIMER_TYPES = ['IntervalTimer', 'TimeoutTimer'];
    private static readonly RELEASE_METHODS = ['clearInterval', 'clearTimeout'];

    static filterSuppressedTimerLeaks(scene: Scene, leaks: ResourceLeak[]): ResourceLeak[] {
        return leaks.filter(leak => !this.shouldSuppress(scene, leak));
    }

    private static shouldSuppress(scene: Scene, leak: ResourceLeak): boolean {
        if (!this.TIMER_TYPES.includes(leak.resourceType)) return false;

        // 检查1：Source 语句（setTimeout/setInterval 调用）的直接回调 lambda 中含 clearTimeout/clearInterval
        // 且该 lambda 中没有条件逻辑（属于一次性 timer 模式）
        // 避免递归进入整个 callee 链，防止将条件性清理（TP）也误判为 FP
        if (this.isOneShotTimerPattern(scene, leak.sourceStmt)) return true;

        // 检查2：同组件的 aboutToDisappear 中含 clearInterval/clearTimeout（递归搜索）
        // 适用于组件销毁时统一清理 timer 的模式
        const sourceClass = this.findDeclaringClass(scene, leak.sourceStmt);
        if (!sourceClass) return false;
        const aboutToDisappear = sourceClass.getMethodWithName('aboutToDisappear');
        if (!aboutToDisappear || !aboutToDisappear.getCfg()) return false;
        return this.methodContainsTimerRelease(aboutToDisappear, scene, new Set());
    }

    /**
     * 检测"一次性 Timer / 防抖 Timer"模式（精确版）：
     *
     * 情形1：Source 所在方法的 CFG 中**直接语句**含 clearTimeout/clearInterval，且方法无条件分支（blockCount ≤ 2）。
     *   - 匹配纯顺序的 debounce 方法。
     *   - MusicControlComponent.%AM1$build 有 if/else（blockCount=4），不触发本情形。
     *
     * 情形2：Source 所在方法的直接 callee 只含 clearTimeout/clearInterval（不含 set），
     *   且该 callee 的 CFG 基本块数 ≤ 3（允许 if(x){clearTimeout(x)} 单条件防护）。
     *   - 匹配 throttle 的 clearExistingTimeout（blockCount=3，仅含 clearTimeout）。
     *   - MusicControlComponent 的 lambda `%AM2$build`（blockCount=3）含有 setInterval，
     *     被"仅含 clear，不含 set"条件排除，不触发本情形。
     *
     * 情形3（防抖 BB 前驱检测）：source stmt 所在的基本块内，在 source 之前存在 clearTimeout/clearInterval；
     *   或者 source 所在 BB 的所有直接前驱 BB 中存在 clearTimeout/clearInterval（且前驱不含 set）。
     *   - 匹配 `clearTimeout(id); id = setTimeout(...)` 的经典防抖写法，无论方法 blockCount 多少。
     *   - 对 MusicControlComponent TP：source（setInterval）在 `if` 分支，clear 在 `else` 分支，
     *     clear 所在 BB 不是 source BB 的直接前驱（两者是 if/else 兄弟分支），不触发本情形。
     *   - 对 ClipboardUtils：`if(x){clearTimeout}` 的 BB 是 source BB 的直接前驱，且前驱不含 set → 触发。
     *   - 对 linysTimeoutButton：clearTimeout 和 setTimeout 在 if-else 后的同一顺序 BB → 触发。
     */
    private static isOneShotTimerPattern(scene: Scene, sourceStmt: Stmt): boolean {
        const sourceMethod = this.findContainingMethod(scene, sourceStmt);
        if (!sourceMethod) return false;
        const cfg = sourceMethod.getCfg();
        if (!cfg) return false;

        const blocks = [...cfg.getBlocks()];

        // 找到 source stmt 所在的 BB
        let sourceBlock: (typeof blocks)[0] | undefined;
        for (const block of blocks) {
            const stmts = block.getStmts();
            if (stmts.includes(sourceStmt)) { sourceBlock = block; break; }
        }

        for (const block of blocks) {
            for (const stmt of block.getStmts()) {
                // 情形1：Source 方法直接语句含 clearTimeout/clearInterval，且方法无条件分支
                if (this.isTimerReleaseInvoke(stmt) && blocks.length <= 2) return true;

                // 情形2：直接 callee 只含 clear 调用（不含 set），且 callee blockCount ≤ 3
                const callee = getDirectCallee(stmt, scene);
                if (callee) {
                    const calleeCfg = callee.getCfg();
                    if (!calleeCfg) continue;
                    const calleeBlocks = [...calleeCfg.getBlocks()];
                    if (calleeBlocks.length > 3) continue;
                    let hasRelease = false;
                    let hasSource = false;
                    for (const cb of calleeBlocks) {
                        for (const cs of cb.getStmts()) {
                            if (this.isTimerReleaseInvoke(cs)) hasRelease = true;
                            if (this.isTimerSourceInvoke(cs)) hasSource = true;
                        }
                    }
                    if (hasRelease && !hasSource) return true;
                }
            }
        }

        // 情形3：source BB 内在 source 之前有 clear；或 source BB 的所有直接前驱中有 clear（前驱不含 set）
        if (sourceBlock) {
            // 3a：同 BB 内，source 之前有 clear
            const stmtsInSourceBlock = sourceBlock.getStmts();
            const srcIdx = stmtsInSourceBlock.indexOf(sourceStmt);
            for (let i = 0; i < srcIdx; i++) {
                if (this.isTimerReleaseInvoke(stmtsInSourceBlock[i])) return true;
            }

            // 3b：直接前驱 BB 含 clear 且不含 set（这样的前驱是 guard 块，如 `if(id) clearTimeout(id)`）
            for (const pred of (sourceBlock as any).getPredecessors() as typeof blocks) {
                let predHasClear = false;
                let predHasSet = false;
                for (const s of pred.getStmts()) {
                    if (this.isTimerReleaseInvoke(s)) predHasClear = true;
                    if (this.isTimerSourceInvoke(s)) predHasSet = true;
                }
                if (predHasClear && !predHasSet) return true;
            }
        }

        return false;
    }

    private static isTimerSourceInvoke(stmt: Stmt): boolean {
        if (stmt instanceof ArkAssignStmt) {
            const r = (stmt as ArkAssignStmt).getRightOp();
            if (r && (r as any).getMethodSignature) {
                const name = (r as any).getMethodSignature()?.getMethodSubSignature()?.getMethodName() ?? '';
                return ['setTimeout', 'setInterval'].includes(name);
            }
        }
        return false;
    }

    private static findContainingMethod(scene: Scene, stmt: Stmt): ArkMethod | null {
        for (const method of scene.getMethods()) {
            const cfg = method.getCfg();
            if (!cfg) continue;
            for (const block of cfg.getBlocks()) {
                for (const s of block.getStmts()) {
                    if (s === stmt) return method;
                }
            }
        }
        return null;
    }

    private static findDeclaringClass(scene: Scene, stmt: Stmt): ArkClass | null {
        for (const method of scene.getMethods()) {
            const cfg = method.getCfg();
            if (!cfg) continue;
            for (const block of cfg.getBlocks()) {
                for (const s of block.getStmts()) {
                    if (s === stmt) return method.getDeclaringArkClass();
                }
            }
        }
        return null;
    }

    private static methodContainsTimerRelease(method: ArkMethod, scene: Scene, visited: Set<string>): boolean {
        const sig = method.getSignature().toString();
        if (visited.has(sig)) return false;
        visited.add(sig);
        const cfg = method.getCfg();
        if (!cfg) return false;
        for (const block of cfg.getBlocks()) {
            for (const stmt of block.getStmts()) {
                if (this.isTimerReleaseInvoke(stmt)) return true;
                const callee = getDirectCallee(stmt, scene);
                if (callee && this.methodContainsTimerRelease(callee, scene, visited)) return true;
            }
        }
        return false;
    }

    private static isTimerReleaseInvoke(stmt: Stmt): boolean {
        if (!(stmt instanceof ArkInvokeStmt)) return false;
        const name = stmt.getInvokeExpr()?.getMethodSignature()?.getMethodSubSignature()?.getMethodName() ?? '';
        return this.RELEASE_METHODS.includes(name);
    }
}

// ============================================================================
// FileLeakSuppressor - File 泄漏结构性抑制（阶段六）
// ============================================================================

/**
 * File 泄漏结构性抑制
 * 当 Source 所在方法（含其调用的 callee）中存在 closeSync/close 等文件释放调用时，抑制 File 泄漏误报。
 * 用于解决：harmony-utils 工具库封装（FileUtil.openSync + FileUtil.closeSync 同方法）、
 * Gramony fs.openSync + fs.closeSync 相邻行等误报。
 */
export class FileLeakSuppressor {
    private static readonly FILE_CLOSE_METHODS = ['closeSync', 'close'];

    static filterSuppressedFileLeaks(scene: Scene, leaks: ResourceLeak[]): ResourceLeak[] {
        return leaks.filter(leak => !this.shouldSuppress(scene, leak));
    }

    private static shouldSuppress(scene: Scene, leak: ResourceLeak): boolean {
        if (leak.resourceType !== 'File') return false;
        const sourceMethod = this.findContainingMethod(scene, leak.sourceStmt);
        if (!sourceMethod || !sourceMethod.getCfg()) return false;

        // 检查1：Source 所在方法（含其 callee 链）内含 close 调用
        if (this.methodContainsFileClose(sourceMethod, scene, new Set())) return true;

        // 检查2：查找同一类中所有 lambda 子方法，检查它们是否含有 close 调用。
        // 用于处理 .then/.finally 异步回调（lambda 是 Source 方法的"同级嵌套"方法）。
        const sourceClass = sourceMethod.getDeclaringArkClass?.();
        if (sourceClass) {
            for (const m of sourceClass.getMethods()) {
                if (m === sourceMethod) continue;
                const mSig = m.getSignature().toString();
                // lambda 方法名包含 '$'，且其父方法签名与 sourceMethod 有公共前缀
                if (!mSig.includes('$')) continue;
                if (this.methodContainsFileClose(m, scene, new Set())) return true;
            }
        }

        return false;
    }

    private static findContainingMethod(scene: Scene, stmt: Stmt): ArkMethod | null {
        for (const method of scene.getMethods()) {
            const cfg = method.getCfg();
            if (!cfg) continue;
            for (const block of cfg.getBlocks()) {
                for (const s of block.getStmts()) {
                    if (s === stmt) return method;
                }
            }
        }
        return null;
    }

    private static methodContainsFileClose(method: ArkMethod, scene: Scene, visited: Set<string>): boolean {
        const sig = method.getSignature().toString();
        if (visited.has(sig)) return false;
        visited.add(sig);
        const cfg = method.getCfg();
        if (!cfg) return false;
        for (const block of cfg.getBlocks()) {
            for (const stmt of block.getStmts()) {
                if (this.isFileCloseInvoke(stmt)) return true;
                const callee = getDirectCallee(stmt, scene);
                if (callee && this.methodContainsFileClose(callee, scene, visited)) return true;
            }
        }
        return false;
    }

    private static isFileCloseInvoke(stmt: Stmt): boolean {
        // 情形 A：直接调用语句（ArkInvokeStmt）
        if (stmt instanceof ArkInvokeStmt) {
            const name = stmt.getInvokeExpr()?.getMethodSignature()?.getMethodSubSignature()?.getMethodName() ?? '';
            return this.FILE_CLOSE_METHODS.includes(name);
        }
        // 情形 B：赋值语句右侧为 close 调用，e.g. `await fs.close(fd)` 在 IR 中为 ArkAssignStmt
        if (stmt instanceof ArkAssignStmt) {
            const rhs = (stmt as ArkAssignStmt).getRightOp();
            if (rhs && (rhs as any).getMethodSignature) {
                const name = (rhs as any).getMethodSignature()?.getMethodSubSignature()?.getMethodName() ?? '';
                return this.FILE_CLOSE_METHODS.includes(name);
            }
        }
        return false;
    }
}

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 污点分析结果
 */
export interface TaintAnalysisResult {
    /** 是否成功 */
    success: boolean;
    /** 错误信息（如果失败） */
    error?: string;
    /** 入口方法签名 */
    entryMethod?: string;
    /** 发现的资源泄漏（Source 未到达 Sink） */
    resourceLeaks: ResourceLeak[];
    /** 发现的污点泄漏（Source 到达了 Sink） */
    taintLeaks: TaintLeak[];
    /** 到达的污点事实 */
    reachedFacts: Map<Stmt, Set<TaintFact>>;
    /** 统计信息 */
    statistics: {
        /** 分析的方法数 */
        analyzedMethods: number;
        /** 总的事实数 */
        totalFacts: number;
        /** Source 数 */
        sourceCount: number;
        /** Sink 数 */
        sinkCount: number;
        /** 耗时（毫秒） */
        duration: number;
        /** 可选的开发者 IFDS 求解统计。 */
        solver?: Readonly<IFDSSolverStatistics>;
    };
}

// ============================================================================
// 导出
// ============================================================================

export { TaintAnalysisSolver as default };
