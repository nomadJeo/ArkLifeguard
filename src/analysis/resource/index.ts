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
 * @file taint/index.ts
 * @description 污点分析模块导出
 */

export {
    TaintFact,
    AccessPath,
    SourceContext,
    SourceDefinition,
    SinkDefinition,
    TaintCategory,
    ILocal,
    IFieldSignature,
    IStmt,
} from './TaintFact';

export {
    SourceSinkManager,
    MethodCallInfo,
    HARMONYOS_SOURCES,
    HARMONYOS_SINKS,
} from './SourceSinkManager';

export {
    TaintAnalysisProblem,
    TaintAnalysisConfig,
    TaintLeak,
    ResourceLeak,
} from './TaintAnalysisProblem';

export {
    ResourceLeakDetector,
    ResourceLeakReport,
    ResourceUsageInfo,
    DetectorConfig,
} from './ResourceLeakDetector';

export {
    TaintAnalysisSolver,
    TaintAnalysisRunner,
    TaintAnalysisResult,
    LifecycleLeakSuppressor,
    FileLeakSuppressor,
} from './TaintAnalysisSolver';

export {
    SourceSinkLocationScanner,
    SourceLocation,
    SinkLocation,
    SourceSinkLocation,
} from './SourceSinkLocationScanner';
