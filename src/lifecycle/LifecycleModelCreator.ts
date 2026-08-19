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
 * @file LifecycleModelCreator.ts
 * @description 扩展版 DummyMain 创建器
 * 
 * 本模块是对原有 DummyMainCreater 的扩展，主要增强功能：
 * 
 * 1. **多 Ability 支持**
 *    - 收集项目中所有 Ability
 *    - 按启动顺序/跳转关系建模
 * 
 * 2. **精细化 UI 回调**
 *    - 利用 ViewTree 提取控件信息
 *    - 按控件实例化后调用对应回调
 * 
 * 3. **页面跳转建模**
 *    - 分析 startAbility/router.pushUrl 等调用
 *    - 在 CFG 中体现跳转关系
 * 
 * 生成的 DummyMain 结构（循环展开版，k = bounds.maxCallbackIterations）：
 * ```
 * function @extendedDummyMain() {
 *     // 1. 静态初始化
 *     staticInit()
 *     count = 0
 *
 *     // 2. 循环展开 k 次（k=1 时 CFG 为 DAG）
 *     // --- Round 1 ---
 *     if (count == 1) { ability1.onCreate(...); ...; ability1.onDestroy() }
 *     if (count == 2) { ability2.onCreate(...); ...; ability2.onDestroy() }
 *     if (count == 3) { comp1.aboutToAppear(); comp1.build(); comp1.onClick() }
 *     ...
 *     // --- Round 2 (k>=2) ---
 *     if (count == 1) { ability1.onCreate(...); ... }
 *     ...
 *
 *     return
 * }
 * ```
 *
 * k=1 时每个回调只出现一次，CFG 为 DAG，IFDS 单趟即可结束（有界约束2）。
 */

import { Scene } from 'arkanalyzer/lib/Scene';
import { ArkClass } from 'arkanalyzer/lib/core/model/ArkClass';
import { ArkMethod } from 'arkanalyzer/lib/core/model/ArkMethod';
import { ArkFile, Language } from 'arkanalyzer/lib/core/model/ArkFile';
import { ArkBody } from 'arkanalyzer/lib/core/model/ArkBody';
import { Local } from 'arkanalyzer/lib/core/base/Local';
import { ClassType, NumberType } from 'arkanalyzer/lib/core/base/Type';
import { Constant } from 'arkanalyzer/lib/core/base/Constant';
import {
    ArkAssignStmt,
    ArkIfStmt,
    ArkInvokeStmt,
    ArkReturnVoidStmt,
} from 'arkanalyzer/lib/core/base/Stmt';
import {
    ArkConditionExpr,
    ArkInstanceInvokeExpr,
    ArkNewExpr,
    ArkStaticInvokeExpr,
    RelationalBinaryOperator,
} from 'arkanalyzer/lib/core/base/Expr';
import { BasicBlock } from 'arkanalyzer/lib/core/graph/BasicBlock';
import { Cfg } from 'arkanalyzer/lib/core/graph/Cfg';
import { ClassSignature, FileSignature, MethodSignature } from 'arkanalyzer/lib/core/model/ArkSignature';
import { ArkSignatureBuilder } from 'arkanalyzer';
import { checkAndUpdateMethod } from 'arkanalyzer/lib/core/model/builder/ArkMethodBuilder';
import { ValueUtil } from 'arkanalyzer/lib';
import { CONSTRUCTOR_NAME } from 'arkanalyzer';

// 导入自定义模块
import { AbilityCollector } from './AbilityCollector';
import { ViewTreeCallbackExtractor } from './ViewTreeCallbackExtractor';
import {
    AbilityInfo,
    ComponentInfo,
    ComponentLifecycleStage,
    UICallbackInfo,
    UIEventType,
    LifecycleModelConfig,
    DEFAULT_LIFECYCLE_CONFIG,
    BoundsConfig,
} from './LifecycleTypes';

// ============================================================================
// LifecycleModelCreator 类
// ============================================================================

/**
 * 扩展版生命周期模型创建器
 * 
 * 使用方式：
 * ```typescript
 * const scene = ...; // 已构建的 Scene
 * const creator = new LifecycleModelCreator(scene);
 * creator.create();
 * const dummyMain = creator.getDummyMain();
 * ```
 */
export class LifecycleModelCreator {
    // ========================================================================
    // 成员变量
    // ========================================================================
    
    /** 分析场景 */
    private scene: Scene;
    
    /** 配置选项 */
    private config: LifecycleModelConfig;
    
    /** Ability 收集器 */
    private abilityCollector: AbilityCollector;
    
    /** ViewTree 回调提取器 */
    private callbackExtractor: ViewTreeCallbackExtractor;
    
    /** 收集到的所有 Ability */
    private abilities: AbilityInfo[] = [];
    
    /** 收集到的所有 Component */
    private components: ComponentInfo[] = [];
    
    /** 生成的 DummyMain 方法 */
    private dummyMain: ArkMethod = new ArkMethod();
    
    /** 临时变量索引（用于生成唯一名称） */
    private tempLocalIndex: number = 0;
    
    /** 类实例 Local 映射：类签名 -> Local 变量 */
    private classInstanceMap: Map<string, Local> = new Map();

    // ========================================================================
    // 构造函数
    // ========================================================================

    /**
     * 创建 LifecycleModelCreator 实例
     * 
     * @param scene 分析场景
     * @param config 配置选项（可选，使用默认配置）
     */
    constructor(scene: Scene, config?: Partial<LifecycleModelConfig>) {
        this.scene = scene;
        // bounds 需要深合并，避免传入部分 bounds 时丢失其余默认值
        this.config = {
            ...DEFAULT_LIFECYCLE_CONFIG,
            ...config,
            bounds: {
                ...DEFAULT_LIFECYCLE_CONFIG.bounds,
                ...(config?.bounds ?? {}),
            } as BoundsConfig,
        };

        // 初始化收集器
        this.abilityCollector = new AbilityCollector(scene);
        this.callbackExtractor = new ViewTreeCallbackExtractor(scene);
    }

    // ========================================================================
    // 公共 API
    // ========================================================================

    /**
     * 创建扩展版 DummyMain
     * 
     * 这是主入口方法，执行完整的构建流程
     */
    public create(): void {
        console.log('[LifecycleModelCreator] Starting creation...');
        
        // Step 1: 收集所有 Ability 和 Component
        this.collectAbilitiesAndComponents();
        
        // Step 2: 提取 UI 回调（如果启用）
        if (this.config.enableViewTreeParsing) {
            this.extractUICallbacks();
        }
        
        // Step 3: 创建 DummyMain 方法的容器（File、Class）
        this.createDummyMainContainer();
        
        // Step 4: 构建 DummyMain 的 CFG
        this.buildDummyMainCfg();
        
        // Step 5: 注册到 Scene
        this.scene.addToMethodsMap(this.dummyMain);
        
        console.log('[LifecycleModelCreator] Creation completed.');
        this.printSummary();
    }

    /**
     * 获取生成的 DummyMain 方法
     */
    public getDummyMain(): ArkMethod {
        return this.dummyMain;
    }

    /**
     * 获取收集到的 Ability 列表
     */
    public getAbilities(): AbilityInfo[] {
        return this.abilities;
    }

    /**
     * 获取收集到的 Component 列表
     */
    public getComponents(): ComponentInfo[] {
        return this.components;
    }

    /**
     * 获取当前有界约束配置
     */
    public getBounds(): BoundsConfig {
        return this.config.bounds;
    }

    /**
     * 获取"方法 → 所属 Ability 类名"映射
     *
     * 供 Phase 2（IFDS 层 Ability 数量约束）使用：
     * 当某条数据流经过某方法时，可查询该方法属于哪个 Ability，
     * 从而在 TaintFact 中追踪已访问的 Ability 集合。
     */
    public getAbilityMethodSet(): Map<ArkMethod, string> {
        const result = new Map<ArkMethod, string>();
        for (const ability of this.abilities) {
            for (const [, method] of ability.lifecycleMethods) {
                result.set(method, ability.arkClass.getName());
            }
        }
        return result;
    }

    // ========================================================================
    // Step 1: 收集 Ability 和 Component
    // ========================================================================

    /**
     * 收集所有 Ability 和 Component
     */
    private collectAbilitiesAndComponents(): void {
        console.log('[LifecycleModelCreator] Collecting Abilities and Components...');
        
        // 收集 Ability（AbilityCollector 已分析 onWindowStageCreate 中的 loadContent，建立 ability.components 关联）
        this.abilities = this.abilityCollector.collectAllAbilities();
        // 阶段四：Entry Ability 优先 - 确保入口 Ability（onCreate/onWindowStageCreate）在 DummyMain 中先执行
        this.abilities.sort((a, b) => (b.isEntry ? 1 : 0) - (a.isEntry ? 1 : 0)); // entry 排前面
        console.log(`  Found ${this.abilities.length} Abilities (entry first)`);
        
        // 收集 Component
        this.components = this.abilityCollector.collectAllComponents();
        // 阶段四：@Entry Component 优先 - loadContent 通常加载入口页，入口组件先执行更符合实际流程
        this.components.sort((a, b) => (b.isEntry ? 1 : 0) - (a.isEntry ? 1 : 0)); // @Entry 排前面
        console.log(`  Found ${this.components.length} Components (@Entry first)`);
    }

    // ========================================================================
    // Step 2: 提取 UI 回调
    // ========================================================================

    /**
     * 提取所有 Component 的 UI 回调
     */
    private extractUICallbacks(): void {
        console.log('[LifecycleModelCreator] Extracting UI callbacks from ViewTree...');
        
        this.callbackExtractor.fillAllComponentCallbacks(this.components);
        
        let totalCallbacks = 0;
        for (const component of this.components) {
            totalCallbacks += component.uiCallbacks.length;
        }
        console.log(`  Extracted ${totalCallbacks} UI callbacks`);
    }

    // ========================================================================
    // Step 3: 创建 DummyMain 容器
    // ========================================================================

    /**
     * 创建 DummyMain 方法的容器结构
     * 
     * 创建：
     * - @extendedDummyFile 虚拟文件
     * - @extendedDummyClass 虚拟类
     * - @extendedDummyMain 方法
     */
    private createDummyMainContainer(): void {
        // 创建虚拟文件
        const dummyFile = new ArkFile(Language.JAVASCRIPT);
        dummyFile.setScene(this.scene);
        const fileSignature = new FileSignature(
            this.scene.getProjectName(),
            '@extendedDummyFile'
        );
        dummyFile.setFileSignature(fileSignature);
        this.scene.setFile(dummyFile);
        
        // 创建虚拟类
        const dummyClass = new ArkClass();
        dummyClass.setDeclaringArkFile(dummyFile);
        const classSignature = new ClassSignature(
            '@extendedDummyClass',
            dummyFile.getFileSignature(),
            null
        );
        dummyClass.setSignature(classSignature);
        dummyFile.addArkClass(dummyClass);
        
        // 创建 DummyMain 方法
        this.dummyMain = new ArkMethod();
        this.dummyMain.setDeclaringArkClass(dummyClass);
        const methodSubSignature = ArkSignatureBuilder.buildMethodSubSignatureFromMethodName(
            '@extendedDummyMain'
        );
        const methodSignature = new MethodSignature(
            dummyClass.getSignature(),
            methodSubSignature
        );
        this.dummyMain.setImplementationSignature(methodSignature);
        this.dummyMain.setLineCol(0);
        checkAndUpdateMethod(this.dummyMain, dummyClass);
        dummyClass.addMethod(this.dummyMain);
    }

    // ========================================================================
    // Step 4: 构建 CFG
    // ========================================================================

    /**
     * 构建 DummyMain 的控制流图（循环展开版）
     *
     * 生成结构（k = config.bounds.maxCallbackIterations）：
     * ```
     * entryBlock (静态初始化)
     *   ↓
     * [第 1 轮]
     *   if(count==1) → Ability1Block_1
     *   if(count==2) → Ability2Block_1
     *   if(count==3) → Comp1Block_1
     *   ...
     *   ↓
     * [第 2 轮]  (k >= 2 时)
     *   if(count==1) → Ability1Block_2
     *   ...
     *   ↓
     * returnBlock
     * ```
     *
     * k=1 时 CFG 为 DAG（无环），IFDS 单趟扫描即可结束，
     * 避免了原 while(true) 循环导致的无界不动点迭代。
     */
    private buildDummyMainCfg(): void {
        const cfg = new Cfg();
        cfg.setDeclaringMethod(this.dummyMain);

        // 创建入口基本块
        const entryBlock = new BasicBlock();
        cfg.addBlock(entryBlock);

        // 4.1 添加静态初始化
        this.addStaticInitialization(cfg, entryBlock);

        // 4.2 创建共享计数器变量（用于 if-branch 的非确定性条件）
        const countLocal = new Local('count', NumberType.getInstance());
        const zero = ValueUtil.getOrCreateNumberConst(0);
        entryBlock.addStmt(new ArkAssignStmt(countLocal, zero));

        // 4.3 循环展开：重复 maxCallbackIterations 轮，每轮生成相同的分支结构
        const maxIter = this.config.bounds.maxCallbackIterations;
        let lastBlocks: BasicBlock[] = [entryBlock];

        for (let iter = 0; iter < maxIter; iter++) {
            let branchIdx = 0;
            const scopedComponents = new Set<ComponentInfo>();

            // 每轮为所有 Ability 添加生命周期调用分支
            for (const ability of this.abilities) {
                for (const component of ability.components) {
                    scopedComponents.add(component);
                }
                lastBlocks = this.addAbilityLifecycleBranch(
                    cfg, ability, lastBlocks, countLocal, ++branchIdx
                );
            }

            // 每轮为所有 Component 添加生命周期和 UI 回调调用分支
            for (const component of this.components) {
                if (scopedComponents.has(component)) {
                    continue;
                }
                lastBlocks = this.addComponentLifecycleBranch(
                    cfg, component, lastBlocks, countLocal, ++branchIdx
                );
            }
        }

        // 4.4 添加返回块（直接连接最后一轮的末尾块，无 back-edge）
        this.createReturnBlock(cfg, lastBlocks);

        // 设置方法体
        const locals = new Set(this.classInstanceMap.values());
        const body = new ArkBody(locals, cfg);
        this.dummyMain.setBody(body);

        // 为所有语句设置 CFG 引用
        this.linkStmtsToCfg(cfg);
    }

    /**
     * 添加静态初始化调用
     */
    private addStaticInitialization(cfg: Cfg, entryBlock: BasicBlock): void {
        let isFirst = true;
        
        for (const method of this.scene.getStaticInitMethods()) {
            const invokeExpr = new ArkStaticInvokeExpr(method.getSignature(), []);
            const invokeStmt = new ArkInvokeStmt(invokeExpr);
            
            if (isFirst) {
                cfg.setStartingStmt(invokeStmt);
                isFirst = false;
            }
            
            entryBlock.addStmt(invokeStmt);
        }
        
        // 如果没有静态初始化方法，设置一个占位
        if (isFirst) {
            // 添加一个 count = 0 的语句作为起始
            const countLocal = new Local('count', NumberType.getInstance());
            const zero = ValueUtil.getOrCreateNumberConst(0);
            const assignStmt = new ArkAssignStmt(countLocal, zero);
            cfg.setStartingStmt(assignStmt);
            entryBlock.addStmt(assignStmt);
        }
    }

    /**
     * 为单个 Ability 添加生命周期调用分支
     * 
     * @returns 更新后的 lastBlocks
     */
    private addAbilityLifecycleBranch(
        cfg: Cfg,
        ability: AbilityInfo,
        lastBlocks: BasicBlock[],
        countLocal: Local,
        branchIndex: number
    ): BasicBlock[] {
        // 创建条件判断块: if (count == branchIndex)
        const condition = new ArkConditionExpr(
            countLocal,
            new Constant(branchIndex.toString(), NumberType.getInstance()),
            RelationalBinaryOperator.Equality
        );
        const ifStmt = new ArkIfStmt(condition);
        const ifBlock = new BasicBlock();
        ifBlock.addStmt(ifStmt);
        cfg.addBlock(ifBlock);
        
        // 连接前驱块
        for (const block of lastBlocks) {
            ifBlock.addPredecessorBlock(block);
            block.addSuccessorBlock(ifBlock);
        }
        
        // 创建 Ability 调用块
        const invokeBlock = new BasicBlock();
        cfg.addBlock(invokeBlock);
        
        // 获取或创建 Ability 实例
        const abilityLocal = this.getOrCreateClassInstance(ability.arkClass);
        
        // 添加实例化语句
        this.addInstanceCreation(invokeBlock, abilityLocal, ability.arkClass);
        
        // 按顺序调用生命周期方法
        for (const stage of this.config.lifecycleOrder) {
            const lifecycleMethod = ability.lifecycleMethods.get(stage);
            if (lifecycleMethod) {
                this.addMethodInvocation(invokeBlock, abilityLocal, lifecycleMethod);
            }
        }

        const embeddedComponentKeys = new Set<string>();
        for (const component of ability.components) {
            const key = component.signature.toString();
            if (embeddedComponentKeys.has(key)) {
                continue;
            }
            embeddedComponentKeys.add(key);
            this.addComponentInvocationsToBlock(invokeBlock, component);
        }
        
        // 连接 if 块和调用块
        ifBlock.addSuccessorBlock(invokeBlock);
        invokeBlock.addPredecessorBlock(ifBlock);
        
        return [ifBlock, invokeBlock];
    }

    /**
     * 为单个 Component 添加生命周期和回调调用分支
     */
    private addComponentLifecycleBranch(
        cfg: Cfg,
        component: ComponentInfo,
        lastBlocks: BasicBlock[],
        countLocal: Local,
        branchIndex: number
    ): BasicBlock[] {
        // 创建条件判断块
        const condition = new ArkConditionExpr(
            countLocal,
            new Constant(branchIndex.toString(), NumberType.getInstance()),
            RelationalBinaryOperator.Equality
        );
        const ifStmt = new ArkIfStmt(condition);
        const ifBlock = new BasicBlock();
        ifBlock.addStmt(ifStmt);
        cfg.addBlock(ifBlock);
        
        // 连接前驱块
        for (const block of lastBlocks) {
            ifBlock.addPredecessorBlock(block);
            block.addSuccessorBlock(ifBlock);
        }
        
        // 创建调用块
        const invokeBlock = new BasicBlock();
        cfg.addBlock(invokeBlock);
        
        // 获取或创建 Component 实例
        const componentLocal = this.getOrCreateClassInstance(component.arkClass);
        
        // 添加实例化
        this.addInstanceCreation(invokeBlock, componentLocal, component.arkClass);
        
        // 调用 Component 生命周期方法（含 aboutToDisappear，以便 clearInterval 等释放逻辑被覆盖）
        this.addComponentInvocationsToBlock(invokeBlock, component, componentLocal);
        
        // 连接
        ifBlock.addSuccessorBlock(invokeBlock);
        invokeBlock.addPredecessorBlock(ifBlock);
        
        return [ifBlock, invokeBlock];
    }

    /**
     * 创建返回块，并将其连接到给定的所有前驱块
     *
     * 循环展开后不再有 whileBlock，改为将最后一轮的末尾块直接连向 returnBlock。
     */
    private addComponentInvocationsToBlock(
        block: BasicBlock,
        component: ComponentInfo,
        componentLocal?: Local
    ): void {
        const local = componentLocal ?? this.getOrCreateClassInstance(component.arkClass);
        const beforeCallbacks: ComponentLifecycleStage[] = [
            ComponentLifecycleStage.ABOUT_TO_APPEAR,
            ComponentLifecycleStage.WILL_APPLY_THEME,
            ComponentLifecycleStage.BUILD,
            ComponentLifecycleStage.DID_BUILD,
            ComponentLifecycleStage.PAGE_SHOW,
        ];
        const afterCallbacks: ComponentLifecycleStage[] = [
            ComponentLifecycleStage.BACK_PRESS,
            ComponentLifecycleStage.KEY_EVENT,
            ComponentLifecycleStage.ABOUT_TO_RECYCLE,
            ComponentLifecycleStage.ABOUT_TO_REUSE,
            ComponentLifecycleStage.PAGE_HIDE,
            ComponentLifecycleStage.ABOUT_TO_DISAPPEAR,
        ];

        for (const stage of beforeCallbacks) {
            const method = component.lifecycleMethods.get(stage);
            if (method) {
                this.addMethodInvocation(block, local, method);
            }
        }

        // UI events occur while the component/page is active, before hide/disappear.
        if (this.config.enableFineGrainedUICallbacks) {
            for (const callback of component.uiCallbacks) {
                this.addUICallbackInvocation(block, local, callback);
            }
        }

        for (const stage of afterCallbacks) {
            const method = component.lifecycleMethods.get(stage);
            if (method) {
                this.addMethodInvocation(block, local, method);
            }
        }
    }

    private createReturnBlock(cfg: Cfg, predecessors: BasicBlock[]): BasicBlock {
        const returnBlock = new BasicBlock();
        const returnStmt = new ArkReturnVoidStmt();
        returnBlock.addStmt(returnStmt);
        cfg.addBlock(returnBlock);

        for (const block of predecessors) {
            block.addSuccessorBlock(returnBlock);
            returnBlock.addPredecessorBlock(block);
        }

        return returnBlock;
    }

    // ========================================================================
    // 辅助方法：语句生成
    // ========================================================================

    /**
     * 获取或创建类实例的 Local 变量
     */
    private getOrCreateClassInstance(arkClass: ArkClass): Local {
        const key = arkClass.getSignature().toString();
        
        if (this.classInstanceMap.has(key)) {
            return this.classInstanceMap.get(key)!;
        }
        
        const local = new Local(
            `%${this.tempLocalIndex++}`,
            new ClassType(arkClass.getSignature())
        );
        this.classInstanceMap.set(key, local);
        
        return local;
    }

    /**
     * 添加类实例化语句
     */
    private addInstanceCreation(
        block: BasicBlock,
        local: Local,
        arkClass: ArkClass
    ): void {
        // local = new ClassName()
        const classType = local.getType() as ClassType;
        const newExpr = new ArkNewExpr(classType);
        const assignStmt = new ArkAssignStmt(local, newExpr);
        block.addStmt(assignStmt);
        local.setDeclaringStmt(assignStmt);
        
        // 调用构造函数
        const constructor = arkClass.getMethodWithName(CONSTRUCTOR_NAME);
        if (constructor) {
            const invokeExpr = new ArkInstanceInvokeExpr(
                local,
                constructor.getSignature(),
                []
            );
            const invokeStmt = new ArkInvokeStmt(invokeExpr);
            block.addStmt(invokeStmt);
        }
    }

    /**
     * 添加方法调用语句（含参数生成）
     * 
     * 工作流程：
     * ```
     * ┌─────────────────────────────────────────────────────────────────┐
     * │                addMethodInvocation() 流程                       │
     * ├─────────────────────────────────────────────────────────────────┤
     * │                                                                 │
     * │  输入: method (如 onCreate)                                     │
     * │         │                                                       │
     * │         ▼                                                       │
     * │  获取参数列表: method.getParameters()                           │
     * │         │                                                       │
     * │         ▼                                                       │
     * │  为每个参数创建 Local 和初始化语句:                             │
     * │  ┌─────────────────────────────────────────────┐               │
     * │  │  %temp0 = new Want()         // ClassType   │               │
     * │  │  %temp1 = new LaunchParam()  // ClassType   │               │
     * │  └─────────────────────────────────────────────┘               │
     * │         │                                                       │
     * │         ▼                                                       │
     * │  生成调用语句:                                                   │
     * │  ┌─────────────────────────────────────────────┐               │
     * │  │  ability.onCreate(%temp0, %temp1)           │               │
     * │  └─────────────────────────────────────────────┘               │
     * │                                                                 │
     * └─────────────────────────────────────────────────────────────────┘
     * ```
     */
    private addMethodInvocation(
        block: BasicBlock,
        instanceLocal: Local,
        method: ArkMethod
    ): void {
        // Step 1: 为方法参数创建 Local 变量并初始化
        const paramLocals = this.createParameterLocals(method, block);
        
        // Step 2: 生成方法调用语句
        const invokeExpr = new ArkInstanceInvokeExpr(
            instanceLocal,
            method.getSignature(),
            paramLocals
        );
        const invokeStmt = new ArkInvokeStmt(invokeExpr);
        block.addStmt(invokeStmt);
        
        // 打印调试信息
        if (paramLocals.length > 0) {
            console.log(`[LifecycleModelCreator] ${method.getName()}(${paramLocals.map(l => l.getName()).join(', ')})`);
        }
    }
    
    /**
     * 为方法参数创建 Local 变量并生成初始化语句
     * 
     * 处理逻辑：
     * - ClassType 参数：创建 new Xxx() 语句
     * - 基本类型参数：创建默认值常量
     * - 未知类型参数：跳过（不传递）
     * 
     * @param method 目标方法
     * @param block 添加语句的基本块
     * @returns 参数 Local 数组
     */
    private createParameterLocals(method: ArkMethod, block: BasicBlock): Local[] {
        const paramLocals: Local[] = [];
        const parameters = method.getParameters();
        
        // 如果方法没有参数，直接返回空数组
        if (parameters.length === 0) {
            return paramLocals;
        }
        
        for (let i = 0; i < parameters.length; i++) {
            const param = parameters[i];
            let paramType = param.getType();
            
            // 如果参数类型未知，尝试从父类方法获取
            if (!paramType) {
                paramType = this.getParamTypeFromSuperClass(method, i);
            }
            
            // 如果仍然无法获取类型，跳过该参数
            if (!paramType) {
                console.log(`[LifecycleModelCreator] Skipping param ${i} of ${method.getName()}: unknown type`);
                continue;
            }
            
            // 创建参数 Local 变量
            const paramLocal = new Local(
                `%param${this.tempLocalIndex++}`,
                paramType
            );
            
            // 如果是 ClassType，生成 new 语句
            if (paramType instanceof ClassType) {
                const newExpr = new ArkNewExpr(paramType);
                const assignStmt = new ArkAssignStmt(paramLocal, newExpr);
                paramLocal.setDeclaringStmt(assignStmt);
                block.addStmt(assignStmt);
                
                // 尝试调用构造函数
                this.tryInvokeConstructor(block, paramLocal, paramType);
            }
            
            paramLocals.push(paramLocal);
        }
        
        return paramLocals;
    }
    
    /**
     * 从父类方法获取参数类型
     * 
     * 当子类方法的参数类型未知时（常见于 SDK 继承场景），
     * 尝试从父类的同名方法获取参数类型
     */
    private getParamTypeFromSuperClass(method: ArkMethod, paramIndex: number): any {
        const declaringClass = method.getDeclaringArkClass();
        const superClass = declaringClass.getSuperClass();
        
        if (!superClass) {
            return null;
        }
        
        // 在父类中查找同名方法
        const superMethod = superClass.getMethodWithName(method.getName());
        if (!superMethod) {
            return null;
        }
        
        const superParams = superMethod.getParameters();
        if (paramIndex < superParams.length) {
            return superParams[paramIndex].getType();
        }
        
        return null;
    }
    
    /**
     * 尝试调用对象的构造函数
     * 
     * 对于 new Xxx() 创建的对象，如果有构造函数，
     * 生成对应的构造函数调用语句
     */
    private tryInvokeConstructor(
        block: BasicBlock,
        local: Local,
        classType: ClassType
    ): void {
        // 从 Scene 获取类
        const arkClass = this.scene.getClass(classType.getClassSignature());
        if (!arkClass) {
            return;
        }
        
        // 查找构造函数
        const constructor = arkClass.getMethodWithName(CONSTRUCTOR_NAME);
        if (!constructor) {
            return;
        }
        
        // 生成构造函数调用（无参数版本）
        const invokeExpr = new ArkInstanceInvokeExpr(
            local,
            constructor.getSignature(),
            []
        );
        const invokeStmt = new ArkInvokeStmt(invokeExpr);
        block.addStmt(invokeStmt);
    }

    /**
     * 添加 UI 回调调用语句（含参数生成）
     * 
     * 工作流程：
     * ```
     * ┌─────────────────────────────────────────────────────────────────┐
     * │            addUICallbackInvocation() 流程                       │
     * ├─────────────────────────────────────────────────────────────────┤
     * │                                                                 │
     * │  输入: callback (如 Button.onClick -> handleClick)              │
     * │         │                                                       │
     * │         ▼                                                       │
     * │  获取回调方法: callback.callbackMethod                          │
     * │         │                                                       │
     * │         ▼                                                       │
     * │  为回调参数创建 Local（如 ClickEvent）:                         │
     * │  ┌─────────────────────────────────────────────┐               │
     * │  │  %event0 = new ClickEvent()                 │               │
     * │  └─────────────────────────────────────────────┘               │
     * │         │                                                       │
     * │         ▼                                                       │
     * │  生成回调调用语句:                                               │
     * │  ┌─────────────────────────────────────────────┐               │
     * │  │  component.handleClick(%event0)             │               │
     * │  └─────────────────────────────────────────────┘               │
     * │                                                                 │
     * └─────────────────────────────────────────────────────────────────┘
     * ```
     * 
     * 支持的回调类型：
     * - onClick(event: ClickEvent)
     * - onTouch(event: TouchEvent)
     * - onChange(value: string)
     * - onAppear() / onDisAppear() - 无参数
     */
    private addUICallbackInvocation(
        block: BasicBlock,
        componentLocal: Local,
        callback: UICallbackInfo
    ): void {
        if (!callback.callbackMethod) {
            return;
        }
        
        // Step 1: 为回调方法的参数创建 Local 变量并初始化
        const paramLocals = this.createCallbackParameterLocals(callback, block);
        
        // Step 2: 生成回调方法调用语句
        const invokeExpr = new ArkInstanceInvokeExpr(
            componentLocal,
            callback.callbackMethod.getSignature(),
            paramLocals
        );
        const invokeStmt = new ArkInvokeStmt(invokeExpr);
        block.addStmt(invokeStmt);
        
        // 打印调试信息
        const paramInfo = paramLocals.length > 0 
            ? `(${paramLocals.map(l => l.getName()).join(', ')})` 
            : '()';
        console.log(`[LifecycleModelCreator] ${callback.componentType}.${callback.eventType} -> ${callback.callbackMethod.getName()}${paramInfo}`);
    }
    
    /**
     * 为 UI 回调方法的参数创建 Local 变量
     * 
     * 常见的回调参数类型：
     * - ClickEvent: onClick 事件
     * - TouchEvent: onTouch 事件
     * - string/number: onChange 等值变化事件
     * 
     * @param callback UI 回调信息
     * @param block 添加语句的基本块
     * @returns 参数 Local 数组
     */
    private createCallbackParameterLocals(
        callback: UICallbackInfo,
        block: BasicBlock
    ): Local[] {
        const paramLocals: Local[] = [];
        
        if (!callback.callbackMethod) {
            return paramLocals;
        }
        
        const parameters = callback.callbackMethod.getParameters();
        
        // 如果回调方法没有参数，直接返回空数组
        if (parameters.length === 0) {
            return paramLocals;
        }
        
        for (let i = 0; i < parameters.length; i++) {
            const param = parameters[i];
            let paramType = param.getType();
            
            // 如果参数类型未知，尝试根据事件类型推断
            if (!paramType) {
                const inferred = this.inferEventParamType(callback.eventType);
                if (inferred) paramType = inferred;
            }
            
            // 如果仍然无法获取类型，跳过该参数
            if (!paramType) {
                console.log(`[LifecycleModelCreator] Skipping callback param ${i}: unknown type`);
                continue;
            }
            
            // 创建参数 Local 变量
            const paramLocal = new Local(
                `%event${this.tempLocalIndex++}`,
                paramType
            );
            
            // 如果是 ClassType，生成 new 语句
            if (paramType instanceof ClassType) {
                const newExpr = new ArkNewExpr(paramType);
                const assignStmt = new ArkAssignStmt(paramLocal, newExpr);
                paramLocal.setDeclaringStmt(assignStmt);
                block.addStmt(assignStmt);
                
                // 尝试调用构造函数
                this.tryInvokeConstructor(block, paramLocal, paramType);
            }
            
            paramLocals.push(paramLocal);
        }
        
        return paramLocals;
    }
    
    /**
     * 根据事件类型推断参数类型
     * 
     * 当回调方法的参数类型未知时，根据事件类型名称推断可能的参数类型
     * 
     * @param eventType 事件类型（如 'onClick', 'onTouch'）
     * @returns 推断的参数类型（ClassType）或 null
     */
    private inferEventParamType(eventType: UIEventType): ClassType | null {
        // 事件类型到参数类名的映射
        const eventParamMap: Record<string, string> = {
            'onClick': 'ClickEvent',
            'onTouch': 'TouchEvent',
            'onAppear': '',           // 无参数
            'onDisAppear': '',        // 无参数
            'onChange': 'string',     // 基本类型，不创建对象
            'onFocus': 'FocusEvent',
            'onBlur': 'BlurEvent',
            'onAreaChange': 'Area',
        };
        
        const paramClassName = eventParamMap[eventType];
        
        // 无参数或基本类型的情况
        if (!paramClassName || paramClassName === 'string') {
            return null;
        }
        
        // 尝试从 Scene 中查找对应的类
        for (const arkClass of this.scene.getClasses()) {
            if (arkClass.getName() === paramClassName) {
                return new ClassType(arkClass.getSignature());
            }
        }
        
        // 如果找不到类，返回 null（跳过该参数）
        console.log(`[LifecycleModelCreator] Event class not found: ${paramClassName}`);
        return null;
    }

    /**
     * 为所有语句设置 CFG 引用
     */
    private linkStmtsToCfg(cfg: Cfg): void {
        for (const block of cfg.getBlocks()) {
            cfg.updateStmt2BlockMap(block);
            for (const stmt of block.getStmts()) {
                stmt.setCfg(cfg);
            }
        }
    }

    // ========================================================================
    // 调试输出
    // ========================================================================

    /**
     * 打印构建摘要
     */
    private printSummary(): void {
        console.log('\n========== LifecycleModelCreator Summary ==========');
        console.log(`Abilities: ${this.abilities.length}`);
        for (const ability of this.abilities) {
            console.log(`  - ${ability.name} (${ability.lifecycleMethods.size} lifecycle methods)`);
        }
        
        console.log(`Components: ${this.components.length}`);
        for (const component of this.components) {
            console.log(`  - ${component.name} (${component.uiCallbacks.length} UI callbacks)`);
        }
        
        console.log(`DummyMain: ${this.dummyMain.getSignature().toString()}`);
        console.log('===================================================\n');
    }
}
