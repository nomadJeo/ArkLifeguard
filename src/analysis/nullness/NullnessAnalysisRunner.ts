/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
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

import { Scene } from '../../adapter/arkanalyzer';
import { NullConstant, UndefinedConstant } from '../../adapter/arkanalyzer';
import { ArkAssignStmt, Stmt } from '../../adapter/arkanalyzer';
import { ArkMethod } from '../../adapter/arkanalyzer';
import {
    createLifecycleModelCreator,
    DEFAULT_LIFECYCLE_MODEL_MODE,
    LifecycleModelMode,
} from '../../lifecycle';
import {
    AbilityLifecycleStage,
    AbilityLifecycleMethodStage,
    BackupExtensionLifecycleStage,
    FormExtensionLifecycleStage,
    LifecycleModelConfig,
} from '../../lifecycle';
import { NullnessFact } from './NullnessFact';
import {
    NullDereferenceDiagnostic,
    NullnessAnalysisConfig,
    NullnessProblem,
} from './NullnessProblem';
import { NullnessSolver } from './NullnessSolver';
import { NullnessLibraryRegistry } from './library/NullnessLibraryRegistry';

export interface NullnessRunnerConfig {
    lifecycleModel?: LifecycleModelMode;
    problem?: NullnessAnalysisConfig;
    lifecycle?: Omit<Partial<LifecycleModelConfig>, 'bounds'> & {
        bounds?: Partial<LifecycleModelConfig['bounds']>;
    };
    libraryRegistry?: NullnessLibraryRegistry;
    /** Analyze project-file module initializers that can introduce nullish facts. */
    analyzeModuleInitializers?: boolean;
    /** Analyze project methods containing registered framework argument sinks. */
    analyzeFrameworkSinkMethods?: boolean;
}

export interface NullnessAnalysisResult {
    success: boolean;
    entryMethod: string;
    diagnostics: readonly NullDereferenceDiagnostic[];
    reachedFacts: Map<Stmt, NullnessFact[]>;
    error?: string;
}

export const NULLNESS_LIFECYCLE_ORDER: AbilityLifecycleMethodStage[] = [
    AbilityLifecycleStage.CREATE,
    AbilityLifecycleStage.WINDOW_STAGE_CREATE,
    AbilityLifecycleStage.WINDOW_STAGE_RESTORE,
    AbilityLifecycleStage.FOREGROUND,
    AbilityLifecycleStage.CONTINUE,
    AbilityLifecycleStage.NEW_WANT,
    AbilityLifecycleStage.DUMP,
    AbilityLifecycleStage.SAVE_STATE,
    AbilityLifecycleStage.SHARE,
    AbilityLifecycleStage.BACK_PRESSED,
    AbilityLifecycleStage.BACKGROUND,
    // A foreground callback may run again on the same Ability instance after backgrounding.
    AbilityLifecycleStage.FOREGROUND,
    AbilityLifecycleStage.PREPARE_TO_TERMINATE,
    AbilityLifecycleStage.PREPARE_TO_TERMINATE_ASYNC,
    AbilityLifecycleStage.WINDOW_STAGE_WILL_DESTROY,
    AbilityLifecycleStage.WINDOW_STAGE_DESTROY,
    AbilityLifecycleStage.DESTROY,
    BackupExtensionLifecycleStage.BACKUP,
    BackupExtensionLifecycleStage.BACKUP_EX,
    BackupExtensionLifecycleStage.RESTORE,
    BackupExtensionLifecycleStage.RESTORE_EX,
    BackupExtensionLifecycleStage.PROCESS,
    FormExtensionLifecycleStage.ADD_FORM,
    FormExtensionLifecycleStage.UPDATE_FORM,
];

/** Runs nullness analysis from the lifecycle-aware DummyMain entry point. */
export class NullnessAnalysisRunner {
    constructor(
        private readonly scene: Scene,
        private readonly config: NullnessRunnerConfig = {}
    ) {}

    runFromDummyMain(): NullnessAnalysisResult {
        try {
            const creator = createLifecycleModelCreator(
                this.scene,
                this.config.lifecycleModel ?? DEFAULT_LIFECYCLE_MODEL_MODE,
                {
                    lifecycleOrder: NULLNESS_LIFECYCLE_ORDER,
                    ...this.config.lifecycle,
                } as Partial<LifecycleModelConfig>
            );
            creator.create();
            return this.runWithDummyMain(creator.getDummyMain());
        } catch (error) {
            return this.analysisFailure(error);
        }
    }

    /** Run against a lifecycle model already created by an application entry point. */
    runWithDummyMain(dummyMain: ArkMethod): NullnessAnalysisResult {
        try {
            const cfg = dummyMain.getCfg();
            const entryStmt = cfg?.getStartingStmt() ?? cfg?.getStartingBlock()?.getHead();
            if (!cfg || !entryStmt) {
                return this.failure('Lifecycle DummyMain has no CFG entry');
            }

            const libraryRegistry = this.config.libraryRegistry ??
                NullnessLibraryRegistry.createDefault(this.scene);
            const problem = new NullnessProblem(
                entryStmt,
                dummyMain,
                this.config.problem,
                libraryRegistry
            );
            const supplementalRoots = new Set<ArkMethod>();
            if (this.config.analyzeModuleInitializers !== false) {
                const moduleInitializers = this.getNullishModuleInitializers(
                    dummyMain,
                    libraryRegistry
                );
                for (const method of moduleInitializers) {
                    supplementalRoots.add(method);
                }
            }
            if (this.config.analyzeFrameworkSinkMethods !== false) {
                const frameworkSinkMethods = this.getNonNullSinkMethods(
                    dummyMain,
                    libraryRegistry
                );
                for (const method of frameworkSinkMethods) {
                    supplementalRoots.add(method);
                }
            }
            // Keep independent roots in independent solver instances. A unified
            // solver retains every contextual PathEdge from every root until the
            // last root finishes, which makes large projects peak at the sum of
            // all root-state spaces. Sequential roots preserve the same union of
            // diagnostics/reached facts while allowing contextual edges to die.
            const solver = new NullnessSolver(problem, this.scene);
            solver.solve();
            const diagnostics = [...problem.getNullDereferences()];
            const reachedFacts = solver.getReachedFacts();
            for (const method of supplementalRoots) {
                const supplementalCfg = method.getCfg();
                const supplementalEntry = supplementalCfg?.getStartingStmt() ??
                    supplementalCfg?.getStartingBlock()?.getHead();
                if (!supplementalCfg || !supplementalEntry) continue;
                const supplementalProblem = new NullnessProblem(
                    supplementalEntry,
                    method,
                    this.config.problem,
                    libraryRegistry
                );
                const supplementalSolver = new NullnessSolver(
                    supplementalProblem,
                    this.scene
                );
                supplementalSolver.solve();
                this.mergeDiagnostics(
                    diagnostics,
                    supplementalProblem.getNullDereferences()
                );
                this.mergeReachedFacts(
                    reachedFacts,
                    supplementalSolver.getReachedFacts()
                );
            }
            return {
                success: true,
                entryMethod: dummyMain.getSignature().toString(),
                diagnostics,
                reachedFacts,
            };
        } catch (error) {
            return this.analysisFailure(error);
        }
    }

    private analysisFailure(error: unknown): NullnessAnalysisResult {
        const detail = error instanceof Error
            ? error.stack ?? error.message
            : String(error);
        return this.failure(`Nullness lifecycle analysis failed: ${detail}`);
    }

    private failure(error: string): NullnessAnalysisResult {
        return {
            success: false,
            entryMethod: '',
            diagnostics: [],
            reachedFacts: new Map(),
            error,
        };
    }

    /**
     * Project module initializers execute when their modules are loaded, but are
     * not ordinary lifecycle callees. Limit the extra roots to initializers with
     * a concrete literal or library-summary nullish source.
     */
    private getNullishModuleInitializers(
        dummyMain: ArkMethod,
        libraryRegistry: NullnessLibraryRegistry
    ): ArkMethod[] {
        const zeroFact = NullnessFact.getZeroFact();
        const methods: ArkMethod[] = [];
        for (const file of this.scene.getFiles()) {
            const method = file.getDefaultClass()?.getDefaultArkMethod();
            const cfg = method?.getCfg();
            if (!method || method === dummyMain || !cfg) continue;
            const hasNullishSource = [...cfg.getBlocks()].some(block =>
                block.getStmts().some(stmt => {
                    if (stmt instanceof ArkAssignStmt &&
                        (stmt.getRightOp() instanceof NullConstant ||
                            stmt.getRightOp() instanceof UndefinedConstant)) {
                        return true;
                    }
                    return [...libraryRegistry.getCallToReturnFacts(stmt, zeroFact)]
                        .some(fact => !fact.isZeroFact() && !fact.isUnresolvedEvidence());
                })
            );
            if (hasNullishSource) methods.push(method);
        }
        return methods;
    }

    /**
     * UI builder methods can be reached through framework routing that is not
     * present in the project call graph. Analyze only methods containing a
     * registered non-null argument sink instead of widening every public method.
     */
    private getNonNullSinkMethods(
        dummyMain: ArkMethod,
        libraryRegistry: NullnessLibraryRegistry
    ): ArkMethod[] {
        const methods: ArkMethod[] = [];
        for (const file of this.scene.getFiles()) {
            for (const arkClass of file.getClasses()) {
                for (const method of arkClass.getMethods()) {
                    const cfg = method.getCfg();
                    if (!cfg || method === dummyMain) continue;
                    const containsSink = [...cfg.getBlocks()].some(block =>
                        block.getStmts().some(stmt =>
                            libraryRegistry.getNonNullArgumentIndices(stmt).length > 0
                        )
                    );
                    if (containsSink) methods.push(method);
                }
            }
        }
        return methods;
    }

    private mergeDiagnostics(
        target: NullDereferenceDiagnostic[],
        incoming: readonly NullDereferenceDiagnostic[]
    ): void {
        for (const diagnostic of incoming) {
            if (target.some(existing =>
                existing.dereferenceLocation.filePath === diagnostic.dereferenceLocation.filePath &&
                existing.dereferenceLocation.line === diagnostic.dereferenceLocation.line &&
                existing.dereferenceLocation.col === diagnostic.dereferenceLocation.col &&
                existing.accessPath.equals(diagnostic.accessPath))) {
                continue;
            }
            target.push(diagnostic);
        }
    }

    private mergeReachedFacts(
        target: Map<Stmt, NullnessFact[]>,
        incoming: Map<Stmt, NullnessFact[]>
    ): void {
        for (const [stmt, facts] of incoming) {
            const merged = target.get(stmt) ?? [];
            for (const fact of facts) {
                if (!merged.some(existing => existing.equals(fact))) merged.push(fact);
            }
            target.set(stmt, merged);
        }
    }
}
