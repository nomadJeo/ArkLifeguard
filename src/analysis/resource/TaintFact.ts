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
 * @file taint/TaintFact.ts
 * @description 污点分析核心数据结构
 * 
 * 借鉴 FlowDroid 的设计思想：
 * - Abstraction → TaintFact
 * - AccessPath → AccessPath  
 * - SourceContext → SourceContext
 * 
 * 注意：为避免循环依赖，这里使用接口而非直接导入具体类
 */

// 注意：不直接导入 ArkAnalyzer 核心模块，避免循环依赖
// 使用下方定义的接口代替

/**
 * 本地变量接口（用于类型约束，避免循环依赖）
 */
export interface ILocal {
    getName(): string;
    getType(): any;
}

/**
 * 字段签名接口（用于类型约束，避免循环依赖）
 */
export interface IFieldSignature {
    getFieldName(): string;
    toString(): string;
}

/**
 * 语句接口（用于类型约束，避免循环依赖）
 */
export interface IStmt {
    getOriginPositionInfo(): { getLineNo(): number; getColNo(): number } | undefined;
}

// ============================================================================
// Source/Sink 定义
// ============================================================================

/**
 * 资源类别
 */
export type TaintCategory = 'resource' | 'memory' | 'sensitive_data' | 'closure';

/**
 * Source 定义 - 描述一种污点源
 */
export interface SourceDefinition {
    /** 唯一标识符 */
    id: string;
    
    /** 方法签名模式 (支持通配符) */
    methodPattern: string;
    
    /** 资源类别 */
    category: TaintCategory;
    
    /** 资源类型名称 (如 "AVPlayer", "FileHandle") */
    resourceType: string;
    
    /** 返回值是否被污染 */
    returnTainted: boolean;
    
    /** 被污染的参数索引（用于输出参数） */
    taintedParamIndices: number[];
    
    /** 对应的 Sink ID（如果有，用于配对） */
    pairedSinkId?: string;

    /**
     * 是否污染所有子字段（对于返回复杂对象的 Source）
     * true 表示对象的所有字段都被视为污染，例如 avPlayer.create() 返回的整个 player 对象
     */
    taintSubFields?: boolean;

    /** 描述信息 */
    description?: string;
}

/**
 * Sink 定义 - 描述一种污点汇
 */
export interface SinkDefinition {
    /** 唯一标识符 */
    id: string;
    
    /** 方法签名模式 */
    methodPattern: string;
    
    /** 类别 */
    category: 'resource_release' | 'memory_free' | 'data_sanitize' | 'closure_release' | 'memory_release';
    
    /** 哪些参数位置需要是污点（表示资源被正确处理） */
    requiredTaintedParamIndices: number[];
    
    /** 是否 this 需要被污染 */
    requireTaintedThis: boolean;
    
    /** 对应的 Source ID（如果有，用于配对） */
    pairedSourceId?: string;
    
    /** 描述信息 */
    description?: string;
}

// ============================================================================
// AccessPath - 访问路径
// ============================================================================

/**
 * 访问路径 - 表示被污染的值及其字段链
 * 
 * 借鉴 FlowDroid 的 AccessPath 设计
 * 
 * @example
 * 简单变量: resource
 *   → AccessPath(base=resource, fields=[])
 * 
 * 字段引用: obj.resource  
 *   → AccessPath(base=obj, fields=[resource])
 * 
 * 深层字段: wrapper.handler.resource
 *   → AccessPath(base=wrapper, fields=[handler, resource])
 * 
 * 静态字段: MyClass.staticField
 *   → AccessPath(base=null, fields=[staticField], isStatic=true)
 */
export class AccessPath {
    /** 基础变量（静态字段时为 null） */
    readonly base: ILocal | null;
    
    /** 基础类型 */
    readonly baseType: any;
    
    /** 字段访问链 */
    readonly fields: IFieldSignature[];
    
    /** 是否污染所有子字段 (用于处理未知深度的传播) */
    readonly taintSubFields: boolean;
    
    /** 是否是静态字段引用 */
    readonly isStatic: boolean;
    
    /** 缓存的哈希值 */
    private _hashCode: number = 0;
    
    /** 空访问路径单例 */
    private static _emptyAccessPath: AccessPath | null = null;
    
    /** 零值访问路径单例（用于 IFDS 算法） */
    private static _zeroAccessPath: AccessPath | null = null;
    
    constructor(
        base: ILocal | null,
        baseType: any = null,
        fields: IFieldSignature[] = [],
        taintSubFields: boolean = false,
        isStatic: boolean = false
    ) {
        this.base = base;
        this.baseType = baseType || (base ? base.getType() : null);
        this.fields = fields;
        this.taintSubFields = taintSubFields;
        this.isStatic = isStatic;
    }
    
    /**
     * 从 Value 创建 AccessPath
     * 
     * 注意：由于循环依赖问题，此方法需要在运行时动态判断类型
     * 如果传入的 value 不符合预期，将返回空路径
     */
    static fromValue(value: any): AccessPath {
        // 检查是否是 Local（有 getName 方法）
        if (value && typeof value.getName === 'function' && typeof value.getType === 'function') {
            // 检查是否是 FieldRef（有 getBase 或 getFieldSignature 方法）
            if (typeof value.getBase === 'function' && typeof value.getFieldSignature === 'function') {
                // ArkInstanceFieldRef
                return new AccessPath(
                    value.getBase(),
                    value.getBase().getType(),
                    [value.getFieldSignature()]
                );
            }
            // 普通 Local
            return new AccessPath(value, value.getType());
        } else if (value && typeof value.getFieldSignature === 'function') {
            // ArkStaticFieldRef（没有 getBase 但有 getFieldSignature）
            return new AccessPath(
                null,
                value.getType?.() || null,
                [value.getFieldSignature()],
                false,
                true
            );
        }
        // 其他类型暂不支持，返回空路径
        return AccessPath.getEmptyAccessPath();
    }
    
    /**
     * 获取空访问路径单例
     */
    static getEmptyAccessPath(): AccessPath {
        if (!AccessPath._emptyAccessPath) {
            AccessPath._emptyAccessPath = new AccessPath(null, null, [], false, false);
        }
        return AccessPath._emptyAccessPath;
    }
    
    /**
     * 获取零值访问路径（IFDS 算法的 zero fact）
     */
    static getZeroAccessPath(): AccessPath {
        if (!AccessPath._zeroAccessPath) {
            // 使用一个特殊标记区分零值和空值
            AccessPath._zeroAccessPath = new AccessPath(null, null, [], false, false);
            (AccessPath._zeroAccessPath as any)._isZero = true;
        }
        return AccessPath._zeroAccessPath;
    }
    
    /**
     * 是否为空访问路径
     */
    isEmpty(): boolean {
        return this.base === null && this.fields.length === 0 && !(this as any)._isZero;
    }
    
    /**
     * 是否为零值
     */
    isZero(): boolean {
        return (this as any)._isZero === true;
    }
    
    /**
     * 是否只是一个本地变量（无字段访问）
     */
    isLocal(): boolean {
        return this.base !== null && this.fields.length === 0;
    }
    
    /**
     * 是否是实例字段引用
     */
    isInstanceFieldRef(): boolean {
        return this.base !== null && this.fields.length > 0 && !this.isStatic;
    }
    
    /**
     * 是否是静态字段引用
     */
    isStaticFieldRef(): boolean {
        return this.isStatic && this.fields.length > 0;
    }
    
    /**
     * 获取第一个字段
     */
    getFirstField(): IFieldSignature | null {
        return this.fields.length > 0 ? this.fields[0] : null;
    }
    
    /**
     * 获取最后一个字段
     */
    getLastField(): IFieldSignature | null {
        return this.fields.length > 0 ? this.fields[this.fields.length - 1] : null;
    }
    
    /**
     * 获取字段数量
     */
    getFieldCount(): number {
        return this.fields.length;
    }
    
    /**
     * 追加字段，返回新的 AccessPath
     */
    appendField(field: IFieldSignature): AccessPath {
        return new AccessPath(
            this.base,
            this.baseType,
            [...this.fields, field],
            this.taintSubFields,
            this.isStatic
        );
    }
    
    /**
     * 移除最后一个字段，返回新的 AccessPath
     */
    dropLastField(): AccessPath {
        if (this.fields.length === 0) return this;
        return new AccessPath(
            this.base,
            this.baseType,
            this.fields.slice(0, -1),
            this.taintSubFields,
            this.isStatic
        );
    }
    
    /**
     * 替换基础变量（用于参数传递）
     */
    replaceBase(newBase: ILocal): AccessPath {
        return new AccessPath(
            newBase,
            newBase.getType(),
            this.fields,
            this.taintSubFields,
            false  // 替换 base 后不再是静态引用
        );
    }
    
    /**
     * 派生一个污染所有子字段的版本
     */
    deriveWithTaintSubFields(): AccessPath {
        if (this.taintSubFields) return this;
        return new AccessPath(
            this.base,
            this.baseType,
            this.fields,
            true,
            this.isStatic
        );
    }
    
    /**
     * 判断是否完全匹配另一个访问路径
     */
    equals(other: AccessPath | null): boolean {
        if (other === null) return false;
        if (this === other) return true;
        
        // 快速哈希比较
        if (this._hashCode !== 0 && other._hashCode !== 0 && this._hashCode !== other._hashCode) {
            return false;
        }
        
        if (this.base !== other.base) return false;
        if (this.taintSubFields !== other.taintSubFields) return false;
        if (this.isStatic !== other.isStatic) return false;
        if (this.fields.length !== other.fields.length) return false;
        
        for (let i = 0; i < this.fields.length; i++) {
            // 比较字段签名（使用 toString 比较）
            if (this.fields[i].toString() !== other.fields[i].toString()) {
                return false;
            }
        }
        return true;
    }
    
    /**
     * 判断是否是另一个访问路径的前缀
     * 
     * @example
     * "obj" isPrefixOf "obj.field" → true
     * "obj.a" isPrefixOf "obj.a.b" → true
     * "obj.a" isPrefixOf "obj.b" → false
     */
    isPrefixOf(other: AccessPath): boolean {
        if (this.base !== other.base) return false;
        if (this.isStatic !== other.isStatic) return false;
        if (this.fields.length > other.fields.length) return false;
        
        for (let i = 0; i < this.fields.length; i++) {
            if (this.fields[i].toString() !== other.fields[i].toString()) {
                return false;
            }
        }
        return true;
    }
    
    /**
     * 判断是否与另一个访问路径有重叠（可能别名）
     */
    mayAlias(other: AccessPath): boolean {
        // 基础变量不同，不可能别名
        if (this.base !== other.base) return false;
        
        // 如果任一方污染所有子字段，且是前缀关系，则可能别名
        if (this.taintSubFields && this.isPrefixOf(other)) return true;
        if (other.taintSubFields && other.isPrefixOf(this)) return true;
        
        // 完全匹配也是别名
        return this.equals(other);
    }
    
    /**
     * 计算哈希值
     */
    hashCode(): number {
        if (this._hashCode !== 0) return this._hashCode;

        let hash = 17;
        if (this.base) {
            for (const ch of this.base.getName()) {
                hash = hash * 31 + ch.charCodeAt(0);
            }
        }
        hash = hash * 31 + this.fields.length;
        hash = hash * 31 + (this.taintSubFields ? 1 : 0);
        hash = hash * 31 + (this.isStatic ? 1 : 0);

        for (const field of this.fields) {
            for (const ch of field.getFieldName()) {
                hash = hash * 31 + ch.charCodeAt(0);
            }
        }

        this._hashCode = hash;
        return hash;
    }
    
    /**
     * 转为字符串表示
     */
    toString(): string {
        if (this.isZero()) return '<ZERO>';
        if (this.isEmpty()) return '<EMPTY>';
        
        let str = this.base ? this.base.getName() : '<static>';
        if (this.fields.length > 0) {
            str += '.' + this.fields.map(f => f.getFieldName()).join('.');
        }
        if (this.taintSubFields) {
            str += '.*';
        }
        return str;
    }
}

// ============================================================================
// SourceContext - 来源上下文
// ============================================================================

/**
 * 来源上下文 - 记录污点的产生信息
 * 
 * 借鉴 FlowDroid 的 SourceContext 设计
 */
export class SourceContext {
    /** Source 定义 */
    readonly definition: SourceDefinition;
    
    /** 产生污点的语句 */
    readonly stmt: IStmt;
    
    /** 原始访问路径 */
    readonly accessPath: AccessPath;
    
    /** 用户自定义数据 */
    readonly userData?: any;
    
    /** 缓存的哈希值 */
    private _hashCode: number = 0;
    
    constructor(
        definition: SourceDefinition,
        stmt: IStmt,
        accessPath: AccessPath,
        userData?: any
    ) {
        this.definition = definition;
        this.stmt = stmt;
        this.accessPath = accessPath;
        this.userData = userData;
    }
    
    equals(other: SourceContext | null): boolean {
        if (other === null) return false;
        if (this === other) return true;
        return this.definition.id === other.definition.id &&
               this.stmt === other.stmt &&
               this.accessPath.equals(other.accessPath);
    }
    
    hashCode(): number {
        if (this._hashCode !== 0) return this._hashCode;
        this._hashCode = this.definition.id.length * 31 + this.accessPath.hashCode();
        return this._hashCode;
    }
    
    toString(): string {
        const pos = this.stmt.getOriginPositionInfo();
        return `[${this.definition.resourceType}]@${pos?.getLineNo() || '?'}:${pos?.getColNo() || '?'}`;
    }
}

// ============================================================================
// TaintFact - 污点事实（IFDS 数据流分析的核心类型）
// ============================================================================

/**
 * 污点事实 - IFDS 数据流分析的核心数据类型
 * 
 * 借鉴 FlowDroid 的 Abstraction 设计：
 * - 作为 DataflowProblem<TaintFact> 的类型参数
 * - 包含被污染的访问路径
 * - 记录污点来源（用于最终报告）
 * - 维护前驱链（用于构建传播路径）
 */
export class TaintFact {
    /** 被污染的访问路径 */
    readonly accessPath: AccessPath;
    
    /** 污点来源上下文（只在 Source 点创建的 fact 中非空） */
    readonly sourceContext: SourceContext | null;
    
    /** 前驱污点（用于构建传播路径） */
    readonly predecessor: TaintFact | null;
    
    /** 当前语句 */
    readonly currentStmt: IStmt | null;
    
    /** 传播深度（用于有界化分析） */
    readonly propagationDepth: number;
    
    /** 是否是隐式流（条件分支导致的污点） */
    readonly isImplicit: boolean;

    /** 已访问的 Ability 集合（用于有界分析约束1：最多访问 N 个 Ability） */
    readonly visitedAbilities: ReadonlySet<string>;

    /** 导航跳数（用于有界分析约束3：最多经过 N 次导航） */
    readonly navigationCount: number;

    /** 缓存的哈希值 */
    private _hashCode: number = 0;
    
    /** 零值单例 */
    private static _zeroFact: TaintFact | null = null;
    
    /**
     * 私有构造函数，使用工厂方法创建实例
     */
    private constructor(
        accessPath: AccessPath,
        sourceContext: SourceContext | null,
        predecessor: TaintFact | null,
        currentStmt: IStmt | null,
        propagationDepth: number,
        isImplicit: boolean,
        visitedAbilities: ReadonlySet<string> = new Set(),
        navigationCount: number = 0
    ) {
        this.accessPath = accessPath;
        this.sourceContext = sourceContext;
        this.predecessor = predecessor;
        this.currentStmt = currentStmt;
        this.propagationDepth = propagationDepth;
        this.isImplicit = isImplicit;
        this.visitedAbilities = visitedAbilities;
        this.navigationCount = navigationCount;
    }
    
    // ========================================================================
    // 工厂方法
    // ========================================================================
    
    /**
     * 创建零值（IFDS 算法需要）
     */
    static getZeroFact(): TaintFact {
        if (!TaintFact._zeroFact) {
            TaintFact._zeroFact = new TaintFact(
                AccessPath.getZeroAccessPath(),
                null,
                null,
                null,
                0,
                false
            );
        }
        return TaintFact._zeroFact;
    }
    
    /**
     * 在 Source 点创建新的污点
     */
    static createFromSource(
        accessPath: AccessPath,
        definition: SourceDefinition,
        sourceStmt: IStmt
    ): TaintFact {
        const sourceContext = new SourceContext(definition, sourceStmt, accessPath);
        return new TaintFact(
            accessPath,
            sourceContext,
            null,
            sourceStmt,
            0,
            false
        );
    }
    
    /**
     * 从 Value 创建 Source 污点
     */
    static createFromSourceValue(
        value: any,
        definition: SourceDefinition,
        sourceStmt: IStmt
    ): TaintFact {
        return TaintFact.createFromSource(
            AccessPath.fromValue(value),
            definition,
            sourceStmt
        );
    }
    
    // ========================================================================
    // 状态判断
    // ========================================================================
    
    /**
     * 判断是否是零值
     */
    isZeroFact(): boolean {
        return this.accessPath.isZero();
    }
    
    /**
     * 获取资源类型（如果有）
     */
    getResourceType(): string | null {
        return this.sourceContext?.definition.resourceType || null;
    }
    
    /**
     * 获取资源类别（如果有）
     */
    getCategory(): TaintCategory | null {
        return this.sourceContext?.definition.category || null;
    }
    
    // ========================================================================
    // 派生方法（传播时创建新污点）
    // ========================================================================
    
    /**
     * 派生新污点 - 访问路径改变
     */
    deriveWithNewAccessPath(newAccessPath: AccessPath, currentStmt: IStmt): TaintFact {
        // 优化：如果相同则不创建新对象
        if (this.accessPath.equals(newAccessPath) && this.currentStmt === currentStmt) {
            return this;
        }
        return new TaintFact(
            newAccessPath,
            this.sourceContext,
            this,
            currentStmt,
            this.propagationDepth + 1,
            this.isImplicit,
            this.visitedAbilities,
            this.navigationCount
        );
    }

    /**
     * 派生新污点 - 保持访问路径，更新当前语句
     */
    deriveWithNewStmt(currentStmt: IStmt): TaintFact {
        if (this.currentStmt === currentStmt) {
            return this;
        }
        return new TaintFact(
            this.accessPath,
            this.sourceContext,
            this,
            currentStmt,
            this.propagationDepth + 1,
            this.isImplicit,
            this.visitedAbilities,
            this.navigationCount
        );
    }
    
    /**
     * 派生新污点 - 追加字段
     */
    deriveWithAppendedField(field: IFieldSignature, currentStmt: IStmt): TaintFact {
        return this.deriveWithNewAccessPath(
            this.accessPath.appendField(field),
            currentStmt
        );
    }
    
    /**
     * 派生新污点 - 移除最后字段
     */
    deriveWithDroppedField(currentStmt: IStmt): TaintFact {
        return this.deriveWithNewAccessPath(
            this.accessPath.dropLastField(),
            currentStmt
        );
    }
    
    /**
     * 派生新污点 - 替换基础变量（用于参数传递）
     */
    deriveWithReplacedBase(newBase: ILocal, currentStmt: IStmt): TaintFact {
        return this.deriveWithNewAccessPath(
            this.accessPath.replaceBase(newBase),
            currentStmt
        );
    }
    
    /**
     * 派生隐式流污点（条件分支）
     */
    deriveImplicit(currentStmt: IStmt): TaintFact {
        return new TaintFact(
            AccessPath.getEmptyAccessPath(),
            this.sourceContext,
            this,
            currentStmt,
            this.propagationDepth + 1,
            true,
            this.visitedAbilities,
            this.navigationCount
        );
    }

    /**
     * 派生新污点 - 进入新 Ability（约束1：Ability 访问计数）
     */
    deriveEnteringAbility(abilityName: string, stmt: IStmt): TaintFact {
        const newVisited = new Set(this.visitedAbilities);
        newVisited.add(abilityName);
        return new TaintFact(
            this.accessPath,
            this.sourceContext,
            this,
            stmt,
            this.propagationDepth + 1,
            this.isImplicit,
            newVisited,
            this.navigationCount
        );
    }

    /**
     * 派生新污点 - 经过导航调用（约束3：导航跳数计数）
     */
    deriveAfterNavigation(stmt: IStmt): TaintFact {
        return new TaintFact(
            this.accessPath,
            this.sourceContext,
            this,
            stmt,
            this.propagationDepth + 1,
            this.isImplicit,
            this.visitedAbilities,
            this.navigationCount + 1
        );
    }
    
    // ========================================================================
    // 路径追踪
    // ========================================================================
    
    /**
     * 获取完整的传播路径（从 Source 到当前）
     */
    getPropagationPath(): IStmt[] {
        const path: IStmt[] = [];
        let current: TaintFact | null = this;
        
        while (current !== null) {
            if (current.currentStmt) {
                path.unshift(current.currentStmt);
            }
            current = current.predecessor;
        }
        
        return path;
    }
    
    /**
     * 获取传播路径上的所有 TaintFact
     */
    getPropagationFactPath(): TaintFact[] {
        const path: TaintFact[] = [];
        let current: TaintFact | null = this;
        
        while (current !== null) {
            path.unshift(current);
            current = current.predecessor;
        }
        
        return path;
    }
    
    // ========================================================================
    // 相等性判断（用于 IFDS 算法的去重）
    // ========================================================================
    
    /**
     * 判断相等
     * 
     * 注意：sourceContext 不参与相等比较，因为同一污点可能有不同来源
     */
    equals(other: TaintFact | null): boolean {
        if (other === null) return false;
        if (this === other) return true;
        
        // 快速哈希比较
        if (this._hashCode !== 0 && other._hashCode !== 0 && this._hashCode !== other._hashCode) {
            return false;
        }
        
        if (!this.accessPath.equals(other.accessPath)) return false;
        if (this.isImplicit !== other.isImplicit) return false;
        if (this.navigationCount !== other.navigationCount) return false;
        if (this.visitedAbilities.size !== other.visitedAbilities.size) return false;
        for (const a of this.visitedAbilities) {
            if (!other.visitedAbilities.has(a)) return false;
        }

        return true;
    }
    
    /**
     * 计算哈希值
     */
    hashCode(): number {
        if (this._hashCode !== 0) return this._hashCode;

        let hash = this.accessPath.hashCode() * 31 + (this.isImplicit ? 1 : 0);
        hash = hash * 31 + this.navigationCount;
        // XOR for order-independent set hashing
        let abilityHash = 0;
        for (const a of this.visitedAbilities) {
            let h = 0;
            for (const ch of a) {
                h = h * 31 + ch.charCodeAt(0);
            }
            abilityHash ^= h;
        }
        hash = hash * 31 + abilityHash;

        this._hashCode = hash;
        return hash;
    }
    
    /**
     * 转为字符串表示
     */
    toString(): string {
        const source = this.sourceContext
            ? `[${this.sourceContext.definition.resourceType}]`
            : '';
        const implicit = this.isImplicit ? '(implicit)' : '';
        const nav = this.navigationCount > 0 ? `;nav=${this.navigationCount}` : '';
        const abilities = this.visitedAbilities.size > 0
            ? `;abilities=${[...this.visitedAbilities].join(',')}`
            : '';
        return `${source}${this.accessPath.toString()}${implicit}@depth=${this.propagationDepth}${nav}${abilities}`;
    }
}

// ============================================================================
// 导出
// ============================================================================

export default TaintFact;
