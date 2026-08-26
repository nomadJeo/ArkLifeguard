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
 * TaintFact 单元测试
 *
 * 注意：为避免 ArkAnalyzer 的循环依赖问题，
 * 这里使用 Mock 对象来模拟 Local、FieldSignature 等类型
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TaintFact, AccessPath, SourceContext, SourceDefinition } from '../../src/analysis/resource/TaintFact';

// ============================================================================
// Mock 对象
// ============================================================================

function createMockLocal(name: string): any {
    return {
        getName: () => name,
        getType: () => ({ toString: () => 'MockType' }),
        hashCode: () => name.length,
    };
}

function createMockFieldSignature(fieldName: string): any {
    return {
        getFieldName: () => fieldName,
        toString: () => `MockClass.${fieldName}`,
        hashCode: () => fieldName.length,
    };
}

function createMockStmt(lineNo: number): any {
    return {
        getOriginPositionInfo: () => ({
            getLineNo: () => lineNo,
            getColNo: () => 0,
        }),
    };
}

// ============================================================================
// AccessPath 测试
// ============================================================================

describe('AccessPath', () => {
    let localX: any;
    let localY: any;
    let fieldA: any;
    let fieldB: any;

    beforeEach(() => {
        localX = createMockLocal('x');
        localY = createMockLocal('y');
        fieldA = createMockFieldSignature('fieldA');
        fieldB = createMockFieldSignature('fieldB');
    });

    describe('基本创建', () => {
        it('应该创建简单变量的访问路径', () => {
            const ap = new AccessPath(localX);

            expect(ap.base).toBe(localX);
            expect(ap.fields.length).toBe(0);
            expect(ap.isLocal()).toBe(true);
            expect(ap.isInstanceFieldRef()).toBe(false);
            expect(ap.isEmpty()).toBe(false);
            expect(ap.toString()).toBe('x');
        });

        it('应该创建字段引用的访问路径', () => {
            const ap = new AccessPath(localX, localX.getType(), [fieldA]);

            expect(ap.base).toBe(localX);
            expect(ap.fields.length).toBe(1);
            expect(ap.getFirstField()).toBe(fieldA);
            expect(ap.isLocal()).toBe(false);
            expect(ap.isInstanceFieldRef()).toBe(true);
            expect(ap.toString()).toBe('x.fieldA');
        });

        it('应该创建深层字段的访问路径', () => {
            const ap = new AccessPath(localX, localX.getType(), [fieldA, fieldB]);

            expect(ap.fields.length).toBe(2);
            expect(ap.getFirstField()).toBe(fieldA);
            expect(ap.getLastField()).toBe(fieldB);
            expect(ap.toString()).toBe('x.fieldA.fieldB');
        });

        it('应该创建静态字段的访问路径', () => {
            const mockType = { toString: () => 'Number' };
            const ap = new AccessPath(null, mockType as any, [fieldA], false, true);

            expect(ap.base).toBeNull();
            expect(ap.isStatic).toBe(true);
            expect(ap.isStaticFieldRef()).toBe(true);
            expect(ap.toString()).toBe('<static>.fieldA');
        });

        it('应该创建污染所有子字段的访问路径', () => {
            const ap = new AccessPath(localX, localX.getType(), [fieldA], true);

            expect(ap.taintSubFields).toBe(true);
            expect(ap.toString()).toBe('x.fieldA.*');
        });
    });

    describe('单例模式', () => {
        it('空访问路径应该是单例', () => {
            const empty1 = AccessPath.getEmptyAccessPath();
            const empty2 = AccessPath.getEmptyAccessPath();

            expect(empty1).toBe(empty2);
            expect(empty1.isEmpty()).toBe(true);
        });

        it('零值访问路径应该是单例', () => {
            const zero1 = AccessPath.getZeroAccessPath();
            const zero2 = AccessPath.getZeroAccessPath();

            expect(zero1).toBe(zero2);
            expect(zero1.isZero()).toBe(true);
            expect(zero1.isEmpty()).toBe(false); // 零值不是空值
        });
    });

    describe('操作方法', () => {
        it('appendField 应该返回新的访问路径', () => {
            const ap1 = new AccessPath(localX);
            const ap2 = ap1.appendField(fieldA);

            expect(ap1.fields.length).toBe(0); // 原对象不变
            expect(ap2.fields.length).toBe(1);
            expect(ap2.base).toBe(localX);
            expect(ap2.getFirstField()).toBe(fieldA);
        });

        it('dropLastField 应该返回新的访问路径', () => {
            const ap1 = new AccessPath(localX, localX.getType(), [fieldA, fieldB]);
            const ap2 = ap1.dropLastField();

            expect(ap1.fields.length).toBe(2); // 原对象不变
            expect(ap2.fields.length).toBe(1);
            expect(ap2.getFirstField()).toBe(fieldA);
        });

        it('replaceBase 应该替换基础变量', () => {
            const ap1 = new AccessPath(localX, localX.getType(), [fieldA]);
            const ap2 = ap1.replaceBase(localY);

            expect(ap1.base).toBe(localX); // 原对象不变
            expect(ap2.base).toBe(localY);
            expect(ap2.fields.length).toBe(1);
        });

        it('deriveWithTaintSubFields 应该标记污染子字段', () => {
            const ap1 = new AccessPath(localX, localX.getType(), [fieldA], false);
            const ap2 = ap1.deriveWithTaintSubFields();

            expect(ap1.taintSubFields).toBe(false);
            expect(ap2.taintSubFields).toBe(true);
        });
    });

    describe('相等性判断', () => {
        it('相同的访问路径应该相等', () => {
            const ap1 = new AccessPath(localX, localX.getType(), [fieldA]);
            const ap2 = new AccessPath(localX, localX.getType(), [fieldA]);

            expect(ap1.equals(ap2)).toBe(true);
            expect(ap1.hashCode()).toBe(ap2.hashCode());
        });

        it('不同基础变量的访问路径应该不相等', () => {
            const ap1 = new AccessPath(localX);
            const ap2 = new AccessPath(localY);

            expect(ap1.equals(ap2)).toBe(false);
        });

        it('不同字段的访问路径应该不相等', () => {
            const ap1 = new AccessPath(localX, localX.getType(), [fieldA]);
            const ap2 = new AccessPath(localX, localX.getType(), [fieldB]);

            expect(ap1.equals(ap2)).toBe(false);
        });

        it('null 比较应该返回 false', () => {
            const ap = new AccessPath(localX);
            expect(ap.equals(null)).toBe(false);
        });
    });

    describe('前缀判断', () => {
        it('简单变量应该是字段引用的前缀', () => {
            const ap1 = new AccessPath(localX);
            const ap2 = new AccessPath(localX, localX.getType(), [fieldA]);

            expect(ap1.isPrefixOf(ap2)).toBe(true);
            expect(ap2.isPrefixOf(ap1)).toBe(false);
        });

        it('短字段链应该是长字段链的前缀', () => {
            const ap1 = new AccessPath(localX, localX.getType(), [fieldA]);
            const ap2 = new AccessPath(localX, localX.getType(), [fieldA, fieldB]);

            expect(ap1.isPrefixOf(ap2)).toBe(true);
            expect(ap2.isPrefixOf(ap1)).toBe(false);
        });

        it('不同路径不应该是前缀', () => {
            const ap1 = new AccessPath(localX, localX.getType(), [fieldA]);
            const ap2 = new AccessPath(localX, localX.getType(), [fieldB]);

            expect(ap1.isPrefixOf(ap2)).toBe(false);
        });
    });

    describe('别名判断', () => {
        it('相同路径应该可能别名', () => {
            const ap1 = new AccessPath(localX, localX.getType(), [fieldA]);
            const ap2 = new AccessPath(localX, localX.getType(), [fieldA]);

            expect(ap1.mayAlias(ap2)).toBe(true);
        });

        it('taintSubFields 的前缀应该与扩展路径可能别名', () => {
            const ap1 = new AccessPath(localX, localX.getType(), [fieldA], true); // x.fieldA.*
            const ap2 = new AccessPath(localX, localX.getType(), [fieldA, fieldB]); // x.fieldA.fieldB

            expect(ap1.mayAlias(ap2)).toBe(true);
        });
    });
});

// ============================================================================
// TaintFact 测试
// ============================================================================

describe('TaintFact', () => {
    let localResource: any;
    let sourceDefinition: SourceDefinition;

    beforeEach(() => {
        localResource = createMockLocal('resource');

        sourceDefinition = {
            id: 'test-source-1',
            methodPattern: 'createResource()',
            category: 'resource',
            resourceType: 'TestResource',
            returnTainted: true,
            taintedParamIndices: [],
        };
    });

    describe('零值', () => {
        it('零值应该是单例', () => {
            const zero1 = TaintFact.getZeroFact();
            const zero2 = TaintFact.getZeroFact();

            expect(zero1).toBe(zero2);
            expect(zero1.isZeroFact()).toBe(true);
        });

        it('零值不应该有来源上下文', () => {
            const zero = TaintFact.getZeroFact();

            expect(zero.sourceContext).toBeNull();
            expect(zero.predecessor).toBeNull();
        });

        it('零值的访问路径应该是零值路径', () => {
            const zero = TaintFact.getZeroFact();

            expect(zero.accessPath.isZero()).toBe(true);
        });
    });

    describe('从 Source 创建', () => {
        it('应该创建带有来源上下文的污点', () => {
            const mockStmt = createMockStmt(10);
            const ap = new AccessPath(localResource);
            const fact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);

            expect(fact.isZeroFact()).toBe(false);
            expect(fact.sourceContext).not.toBeNull();
            expect(fact.sourceContext?.definition).toBe(sourceDefinition);
            expect(fact.getResourceType()).toBe('TestResource');
            expect(fact.getCategory()).toBe('resource');
            expect(fact.propagationDepth).toBe(0);
        });

        it('应该正确设置当前语句', () => {
            const mockStmt = createMockStmt(42);
            const ap = new AccessPath(localResource);
            const fact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);

            expect(fact.currentStmt).toBe(mockStmt);
        });
    });

    describe('派生方法', () => {
        let originalFact: TaintFact;
        let mockStmt1: any;
        let mockStmt2: any;

        beforeEach(() => {
            mockStmt1 = createMockStmt(10);
            mockStmt2 = createMockStmt(20);

            const ap = new AccessPath(localResource);
            originalFact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt1);
        });

        it('deriveWithNewStmt 应该增加传播深度', () => {
            const derivedFact = originalFact.deriveWithNewStmt(mockStmt2);

            expect(derivedFact.propagationDepth).toBe(1);
            expect(derivedFact.predecessor).toBe(originalFact);
            expect(derivedFact.currentStmt).toBe(mockStmt2);
        });

        it('deriveWithNewAccessPath 应该改变访问路径', () => {
            const newLocal = createMockLocal('newResource');
            const newAp = new AccessPath(newLocal);

            const derivedFact = originalFact.deriveWithNewAccessPath(newAp, mockStmt2);

            expect(derivedFact.accessPath.base).toBe(newLocal);
            expect(derivedFact.propagationDepth).toBe(1);
            expect(derivedFact.sourceContext).toBe(originalFact.sourceContext); // 来源保持不变
        });

        it('deriveWithReplacedBase 应该替换基础变量', () => {
            const newLocal = createMockLocal('param');

            const derivedFact = originalFact.deriveWithReplacedBase(newLocal, mockStmt2);

            expect(derivedFact.accessPath.base).toBe(newLocal);
        });

        it('deriveWithAppendedField 应该追加字段', () => {
            const field = createMockFieldSignature('newField');

            const derivedFact = originalFact.deriveWithAppendedField(field, mockStmt2);

            expect(derivedFact.accessPath.fields.length).toBe(1);
            expect(derivedFact.accessPath.getFirstField()).toBe(field);
        });

        it('deriveImplicit 应该创建隐式流污点', () => {
            const derivedFact = originalFact.deriveImplicit(mockStmt2);

            expect(derivedFact.isImplicit).toBe(true);
            expect(derivedFact.accessPath.isEmpty()).toBe(true);
        });

        it('相同状态的派生应该返回自身（优化）', () => {
            const sameFact = originalFact.deriveWithNewStmt(mockStmt1);

            expect(sameFact).toBe(originalFact);
        });
    });

    describe('传播路径', () => {
        it('应该能获取完整的传播路径', () => {
            const mockStmt1 = createMockStmt(1);
            const mockStmt2 = createMockStmt(2);
            const mockStmt3 = createMockStmt(3);

            const ap = new AccessPath(localResource);
            const fact1 = TaintFact.createFromSource(ap, sourceDefinition, mockStmt1);
            const fact2 = fact1.deriveWithNewStmt(mockStmt2);
            const fact3 = fact2.deriveWithNewStmt(mockStmt3);

            const path = fact3.getPropagationPath();

            expect(path.length).toBe(3);
            expect(path[0]).toBe(mockStmt1);
            expect(path[1]).toBe(mockStmt2);
            expect(path[2]).toBe(mockStmt3);
        });

        it('应该能获取传播路径上的所有 TaintFact', () => {
            const mockStmt1 = createMockStmt(1);
            const mockStmt2 = createMockStmt(2);

            const ap = new AccessPath(localResource);
            const fact1 = TaintFact.createFromSource(ap, sourceDefinition, mockStmt1);
            const fact2 = fact1.deriveWithNewStmt(mockStmt2);

            const factPath = fact2.getPropagationFactPath();

            expect(factPath.length).toBe(2);
            expect(factPath[0]).toBe(fact1);
            expect(factPath[1]).toBe(fact2);
        });
    });

    describe('相等性判断', () => {
        it('相同访问路径的污点应该相等', () => {
            const mockStmt = createMockStmt(10);
            const ap = new AccessPath(localResource);

            const fact1 = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);
            const fact2 = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);

            expect(fact1.equals(fact2)).toBe(true);
            expect(fact1.hashCode()).toBe(fact2.hashCode());
        });

        it('不同访问路径的污点应该不相等', () => {
            const mockStmt = createMockStmt(10);
            const local1 = createMockLocal('resource1');
            const local2 = createMockLocal('resource2');

            const fact1 = TaintFact.createFromSource(new AccessPath(local1), sourceDefinition, mockStmt);
            const fact2 = TaintFact.createFromSource(new AccessPath(local2), sourceDefinition, mockStmt);

            expect(fact1.equals(fact2)).toBe(false);
        });

        it('null 比较应该返回 false', () => {
            const mockStmt = createMockStmt(10);
            const ap = new AccessPath(localResource);
            const fact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);

            expect(fact.equals(null)).toBe(false);
        });
    });

    describe('toString', () => {
        it('应该包含资源类型信息', () => {
            const mockStmt = createMockStmt(10);
            const ap = new AccessPath(localResource);
            const fact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);

            const str = fact.toString();

            expect(str).toContain('TestResource');
            expect(str).toContain('resource');
            expect(str).toContain('depth=0');
        });

        it('零值应该有特殊表示', () => {
            const zero = TaintFact.getZeroFact();
            const str = zero.toString();

            expect(str).toContain('ZERO');
        });
    });

    // ========================================================================
    // 有界分析约束（Phase 2/3 新增字段）
    // ========================================================================

    describe('有界分析约束', () => {
        let ap: AccessPath;
        let mockStmt: any;
        let mockStmt2: any;

        beforeEach(() => {
            ap = new AccessPath(localResource);
            mockStmt = createMockStmt(10);
            mockStmt2 = createMockStmt(20);
        });

        describe('visitedAbilities', () => {
            it('新创建的污点应该有空的 visitedAbilities', () => {
                const fact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);
                expect(fact.visitedAbilities.size).toBe(0);
            });

            it('deriveEnteringAbility 应该添加 Ability 名称到集合', () => {
                const fact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);
                const derived = fact.deriveEnteringAbility('EntryAbility', mockStmt);
                expect(derived.visitedAbilities.size).toBe(1);
                expect(derived.visitedAbilities.has('EntryAbility')).toBe(true);
            });

            it('再次进入同一 Ability 不应该增加集合大小', () => {
                const fact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);
                const derived1 = fact.deriveEnteringAbility('EntryAbility', mockStmt);
                const derived2 = derived1.deriveEnteringAbility('EntryAbility', mockStmt2);
                expect(derived2.visitedAbilities.size).toBe(1);
            });

            it('进入不同 Ability 应该分别记录', () => {
                const fact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);
                const derived = fact.deriveEnteringAbility('AbilityA', mockStmt).deriveEnteringAbility('AbilityB', mockStmt2);
                expect(derived.visitedAbilities.size).toBe(2);
                expect(derived.visitedAbilities.has('AbilityA')).toBe(true);
                expect(derived.visitedAbilities.has('AbilityB')).toBe(true);
            });

            it('deriveEnteringAbility 不应该改变 navigationCount', () => {
                const fact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);
                const derived = fact.deriveEnteringAbility('EntryAbility', mockStmt);
                expect(derived.navigationCount).toBe(0);
            });
        });

        describe('navigationCount', () => {
            it('新创建的污点应该有 navigationCount=0', () => {
                const fact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);
                expect(fact.navigationCount).toBe(0);
            });

            it('deriveAfterNavigation 应该递增 navigationCount', () => {
                const fact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);
                const derived = fact.deriveAfterNavigation(mockStmt2);
                expect(derived.navigationCount).toBe(1);
            });

            it('多次导航应该正确累计 navigationCount', () => {
                const fact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);
                const hop3 = fact.deriveAfterNavigation(mockStmt).deriveAfterNavigation(mockStmt).deriveAfterNavigation(mockStmt2);
                expect(hop3.navigationCount).toBe(3);
            });

            it('deriveAfterNavigation 不应该改变 visitedAbilities', () => {
                const fact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);
                const withAbility = fact.deriveEnteringAbility('AbilityA', mockStmt);
                const afterNav = withAbility.deriveAfterNavigation(mockStmt2);
                expect(afterNav.visitedAbilities.size).toBe(1);
                expect(afterNav.visitedAbilities.has('AbilityA')).toBe(true);
            });
        });

        describe('equals() 包含有界约束字段', () => {
            it('不同 visitedAbilities 的污点应该不相等', () => {
                const fact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);
                const withA = fact.deriveEnteringAbility('AbilityA', mockStmt);
                const withB = fact.deriveEnteringAbility('AbilityB', mockStmt);
                expect(withA.equals(withB)).toBe(false);
            });

            it('不同 navigationCount 的污点应该不相等', () => {
                const fact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);
                const nav1 = fact.deriveAfterNavigation(mockStmt);
                expect(fact.equals(nav1)).toBe(false);
            });

            it('相同有界约束字段的污点应该相等', () => {
                const fact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);
                const nav1 = fact.deriveAfterNavigation(mockStmt);
                const nav2 = fact.deriveAfterNavigation(mockStmt);
                expect(nav1.equals(nav2)).toBe(true);
            });
        });

        describe('派生方法保留有界约束字段', () => {
            it('deriveWithNewStmt 应该保留 visitedAbilities 和 navigationCount', () => {
                const fact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);
                const withBoth = fact.deriveEnteringAbility('AbilityA', mockStmt).deriveAfterNavigation(mockStmt);
                const derived = withBoth.deriveWithNewStmt(mockStmt2);
                expect(derived.visitedAbilities.has('AbilityA')).toBe(true);
                expect(derived.navigationCount).toBe(1);
            });

            it('deriveWithNewAccessPath 应该保留 visitedAbilities 和 navigationCount', () => {
                const fact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);
                const withBoth = fact.deriveEnteringAbility('AbilityA', mockStmt).deriveAfterNavigation(mockStmt);
                const newLocal = createMockLocal('newRes');
                const derived = withBoth.deriveWithNewAccessPath(new AccessPath(newLocal), mockStmt2);
                expect(derived.visitedAbilities.has('AbilityA')).toBe(true);
                expect(derived.navigationCount).toBe(1);
            });
        });

        describe('toString() 包含有界约束信息', () => {
            it('有导航跳数时应该显示 nav=N', () => {
                const fact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);
                const nav = fact.deriveAfterNavigation(mockStmt);
                expect(nav.toString()).toContain('nav=1');
            });

            it('有访问 Ability 时应该显示 abilities=...', () => {
                const fact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);
                const withAbility = fact.deriveEnteringAbility('EntryAbility', mockStmt);
                expect(withAbility.toString()).toContain('abilities=EntryAbility');
            });

            it('无导航和 Ability 时不应该显示额外信息', () => {
                const fact = TaintFact.createFromSource(ap, sourceDefinition, mockStmt);
                const str = fact.toString();
                expect(str).not.toContain('nav=');
                expect(str).not.toContain('abilities=');
            });
        });
    });
});

// ============================================================================
// SourceContext 测试
// ============================================================================

describe('SourceContext', () => {
    it('应该正确存储来源信息', () => {
        const mockStmt = createMockStmt(42);
        const ap = new AccessPath(createMockLocal('x'));

        const definition: SourceDefinition = {
            id: 'source-1',
            methodPattern: 'test()',
            category: 'resource',
            resourceType: 'FileHandle',
            returnTainted: true,
            taintedParamIndices: [],
        };

        const ctx = new SourceContext(definition, mockStmt, ap);

        expect(ctx.definition).toBe(definition);
        expect(ctx.stmt).toBe(mockStmt);
        expect(ctx.accessPath).toBe(ap);
        expect(ctx.toString()).toContain('FileHandle');
        expect(ctx.toString()).toContain('42');
    });

    it('相同来源上下文应该相等', () => {
        const mockStmt = createMockStmt(10);
        const ap = new AccessPath(createMockLocal('x'));
        const definition: SourceDefinition = {
            id: 'source-1',
            methodPattern: 'test()',
            category: 'resource',
            resourceType: 'Test',
            returnTainted: true,
            taintedParamIndices: [],
        };

        const ctx1 = new SourceContext(definition, mockStmt, ap);
        const ctx2 = new SourceContext(definition, mockStmt, ap);

        expect(ctx1.equals(ctx2)).toBe(true);
        expect(ctx1.hashCode()).toBe(ctx2.hashCode());
    });
});
