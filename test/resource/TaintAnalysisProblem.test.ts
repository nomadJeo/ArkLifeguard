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
 * TaintAnalysisProblem 单元测试
 *
 * 注意：由于 ArkAnalyzer 存在循环依赖问题，无法在 vitest 中直接导入
 * TaintAnalysisProblem。因此这里主要测试：
 * 1. FlowFunction 接口的独立实现
 * 2. TaintFact 和 SourceSinkManager 的集成
 *
 * TaintAnalysisProblem 的完整测试需要在集成测试环境中进行。
 */

import { describe, it, expect } from 'vitest';
import { TaintFact, AccessPath, ILocal, IStmt, SourceDefinition } from '../../src/analysis/resource/TaintFact';
import { SourceSinkManager } from '../../src/analysis/resource/SourceSinkManager';
import {
    GenFlowFunction,
    IdentityFlowFunction,
    KillAllFlowFunction,
} from '../../src/analysis/resource/TaintAnalysisProblem';

// ============================================================================
// Mock 对象
// ============================================================================

function createMockLocal(name: string): ILocal {
    return {
        getName: () => name,
        getType: () => ({ toString: () => 'MockType' }),
    };
}

function createMockStmt(lineNo: number = 1): IStmt {
    return {
        getOriginPositionInfo: () => ({
            getLineNo: () => lineNo,
            getColNo: () => 0,
        }),
    };
}

// ============================================================================
// FlowFunction 测试
// ============================================================================

describe('FlowFunctions', () => {
    describe('KillAllFlowFunction', () => {
        it('应该返回空集', () => {
            const ff = new KillAllFlowFunction();
            const fact = TaintFact.getZeroFact();

            const result = ff.getDataFacts(fact);

            expect(result.size).toBe(0);
        });
    });

    describe('IdentityFlowFunction', () => {
        it('应该返回输入的污点', () => {
            const ff = new IdentityFlowFunction();
            const fact = TaintFact.getZeroFact();

            const result = ff.getDataFacts(fact);

            expect(result.size).toBe(1);
            expect(result.has(fact)).toBe(true);
        });

        it('应该保持非零值污点不变', () => {
            const ff = new IdentityFlowFunction();
            const local = createMockLocal('x');
            const ap = new AccessPath(local, []);
            const sourceDef: SourceDefinition = {
                id: 'test',
                methodPattern: 'test',
                category: 'resource',
                returnTainted: true,
                taintedParamIndices: [],
                resourceType: 'TestResource',
            };
            const stmt = createMockStmt();
            const fact = TaintFact.createFromSource(ap, sourceDef, stmt);

            const result = ff.getDataFacts(fact);

            expect(result.size).toBe(1);
            expect(result.has(fact)).toBe(true);
        });
    });

    describe('GenFlowFunction', () => {
        it('应该生成新的污点并保留原有污点', () => {
            const local = createMockLocal('y');
            const ap = new AccessPath(local, []);
            const sourceDef: SourceDefinition = {
                id: 'test',
                methodPattern: 'test',
                category: 'resource',
                returnTainted: true,
                taintedParamIndices: [],
                resourceType: 'TestResource',
            };
            const stmt = createMockStmt();
            const newFact = TaintFact.createFromSource(ap, sourceDef, stmt);

            const ff = new GenFlowFunction(new Set([newFact]));
            const inputFact = TaintFact.getZeroFact();

            const result = ff.getDataFacts(inputFact);

            expect(result.size).toBe(2);
            expect(result.has(inputFact)).toBe(true);
            expect(result.has(newFact)).toBe(true);
        });
    });
});

// ============================================================================
// TaintAnalysisProblem 概念测试
//
// 注意：由于循环依赖问题，这里测试的是 TaintAnalysisProblem 的设计概念
// 实际的 TaintAnalysisProblem 类需要在完整的 ArkAnalyzer 环境中测试
// ============================================================================

describe('TaintAnalysisProblem 概念验证', () => {
    describe('TaintFact 相等性判断', () => {
        it('零值应该相等', () => {
            const zero1 = TaintFact.getZeroFact();
            const zero2 = TaintFact.getZeroFact();

            expect(zero1.equals(zero2)).toBe(true);
        });

        it('相同 AccessPath 的污点应该相等', () => {
            const local = createMockLocal('x');
            const ap = new AccessPath(local, []);
            const sourceDef: SourceDefinition = {
                id: 'test',
                methodPattern: 'test',
                category: 'resource',
                returnTainted: true,
                taintedParamIndices: [],
                resourceType: 'TestResource',
            };
            const stmt = createMockStmt();

            const fact1 = TaintFact.createFromSource(ap, sourceDef, stmt);
            const fact2 = TaintFact.createFromSource(ap, sourceDef, stmt);

            expect(fact1.equals(fact2)).toBe(true);
        });

        it('不同 AccessPath 的污点应该不相等', () => {
            const local1 = createMockLocal('x');
            const local2 = createMockLocal('y');
            const ap1 = new AccessPath(local1, []);
            const ap2 = new AccessPath(local2, []);
            const sourceDef: SourceDefinition = {
                id: 'test',
                methodPattern: 'test',
                category: 'resource',
                returnTainted: true,
                taintedParamIndices: [],
                resourceType: 'TestResource',
            };
            const stmt = createMockStmt();

            const fact1 = TaintFact.createFromSource(ap1, sourceDef, stmt);
            const fact2 = TaintFact.createFromSource(ap2, sourceDef, stmt);

            expect(fact1.equals(fact2)).toBe(false);
        });
    });

    describe('SourceSinkManager 集成', () => {
        it('应该能识别 HarmonyOS Source', () => {
            const ssm = new SourceSinkManager();

            const source = ssm.isSource({
                className: 'media',
                methodName: 'createAVPlayer',
            });

            expect(source).not.toBeNull();
            expect(source?.returnTainted).toBe(true);
        });

        it('应该能识别 HarmonyOS Sink', () => {
            const ssm = new SourceSinkManager();

            const sink = ssm.isSink({
                className: 'AVPlayer',
                methodName: 'release',
            });

            expect(sink).not.toBeNull();
            expect(sink?.requireTaintedThis).toBe(true);
        });
    });
});

// ============================================================================
// 集成测试（概念验证）
// ============================================================================

describe('TaintAnalysisProblem 集成概念', () => {
    it('应该能够检测 HarmonyOS 资源 Source', () => {
        const ssm = new SourceSinkManager();

        // 验证 Source 定义存在
        const avPlayerSource = ssm.isSource({
            className: 'media',
            methodName: 'createAVPlayer',
        });

        expect(avPlayerSource).not.toBeNull();
        expect(avPlayerSource?.returnTainted).toBe(true);
        expect(avPlayerSource?.resourceType).toBe('AVPlayer');
    });

    it('应该能够检测 HarmonyOS 资源 Sink', () => {
        const ssm = new SourceSinkManager();

        // 验证 Sink 定义存在
        const avPlayerSink = ssm.isSink({
            className: 'AVPlayer',
            methodName: 'release',
        });

        expect(avPlayerSink).not.toBeNull();
        expect(avPlayerSink?.requireTaintedThis).toBe(true);
    });

    it('Source 和 Sink 应该正确配对', () => {
        const ssm = new SourceSinkManager();

        const source = ssm.isSource({
            className: 'media',
            methodName: 'createAVPlayer',
        });

        const pairedSink = ssm.getPairedSink(source!);

        expect(pairedSink).not.toBeNull();
        expect(pairedSink?.id).toBe('AVPlayer.release');
    });

    it('TaintFact 传播路径应该正确', () => {
        const local = createMockLocal('player');
        const ap = new AccessPath(local, []);
        const sourceDef: SourceDefinition = {
            id: 'media.createAVPlayer',
            methodPattern: 'media.createAVPlayer',
            category: 'resource',
            resourceType: 'AVPlayer',
            returnTainted: true,
            taintedParamIndices: [],
        };
        const stmt1 = createMockStmt(10);
        const stmt2 = createMockStmt(20);

        const fact1 = TaintFact.createFromSource(ap, sourceDef, stmt1);
        const fact2 = fact1.deriveWithNewStmt(stmt2);

        const path = fact2.getPropagationPath();

        expect(path).toHaveLength(2);
    });
});
