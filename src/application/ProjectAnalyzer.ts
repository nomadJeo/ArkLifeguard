/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Scene, SceneConfig, Sdk } from '../adapter/arkanalyzer';
import {
    AbilityInfo,
    ComponentInfo,
    createLifecycleModelCreator,
    DEFAULT_LIFECYCLE_CONFIG,
    DEFAULT_LIFECYCLE_MODEL_MODE,
    LifecycleModelCreator,
    LifecycleModelMode,
    NavigationAnalyzer,
} from '../lifecycle';
import {
    NULLNESS_LIFECYCLE_ORDER,
    NullnessAnalysisRunner,
} from '../analysis/nullness/NullnessAnalysisRunner';
import {
    ResourceLeakDetector,
    SourceSinkLocationScanner,
    TaintAnalysisRunner,
} from '../analysis/resource';
import type { IFDSSolverStatistics } from '../ifds';

export interface ProjectAnalysisOptions {
    sdkRoot?: string;
    sdkPaths?: string[];
    inferTypes?: boolean;
    extractUICallbacks?: boolean;
    analyzeNavigation?: boolean;
    runNullness?: boolean;
    runResourceAnalysis?: boolean;
    lifecycleModel?: LifecycleModelMode;
    maxCallbackIterations?: number;
    maxAbilitiesPerFlow?: number;
    maxNavigationHops?: number;
    maxAccessPathLength?: number;
    maxPropagationDepth?: number;
    reportUnresolvedReturns?: boolean;
    collectSolverStatistics?: boolean;
    verbose?: boolean;
}

export interface AnalysisLocation {
    filePath: string;
    relativePath: string;
    line: number;
    col: number;
}

export interface NullnessDiagnosticRecord {
    nullness: string;
    accessPath: string;
    description: string;
    confidence: 'high' | 'low';
    source: AnalysisLocation;
    dereference: AnalysisLocation;
}

export interface ResourceLeakRecord {
    sourceId: string;
    resourceType: string;
    expectedSink: string;
    description: string;
    source: AnalysisLocation;
}

export interface TaintLeakRecord {
    sourceId: string;
    description: string;
    source: AnalysisLocation;
    sink: AnalysisLocation;
    propagationPath: AnalysisLocation[];
}

export interface SourceSinkLocationRecord {
    resourceType: string;
    methodPattern: string;
    methodSignature: string;
    location: AnalysisLocation;
}

export interface MethodLocalResourceLeakRecord {
    resourceType: string;
    sourceMethod: string;
    className: string;
    methodName: string;
    filePath: string;
    lineNumber: number;
    expectedSink: string;
    variableName: string;
    severity: 'error' | 'warning' | 'info';
    description: string;
}

export interface ProjectAnalysisResult {
    schemaVersion: 1;
    /** 保留既有值以兼容已接入的报告消费者；启用模块以 settings 字段为准。 */
    analysisKind: 'lifecycle-nullness';
    status: 'success' | 'failed';
    project: {
        path: string;
        name: string;
        analyzedAt: string;
    };
    settings: {
        sdkPaths: string[];
        inferTypes: boolean;
        extractUICallbacks: boolean;
        analyzeNavigation: boolean;
        runNullness: boolean;
        runResourceAnalysis: boolean;
        lifecycleModel: LifecycleModelMode;
        bounds: {
            maxCallbackIterations: number;
            maxAbilitiesPerFlow: number;
            maxNavigationHops: number;
            maxAccessPathLength: number;
            maxPropagationDepth: number;
        };
        boundEnforcement: {
            maxCallbackIterations: 'enforced' | 'inactive-with-cyclic-model';
            maxAbilitiesPerFlow: 'enforced' | 'inactive-without-resource-analysis';
            maxNavigationHops: 'enforced' | 'inactive-without-resource-analysis';
            maxAccessPathLength: 'enforced';
            maxPropagationDepth: 'enforced';
        };
        reportUnresolvedReturns: boolean;
        collectSolverStatistics: boolean;
    };
    summary: {
        projectFiles: number;
        sceneFiles: number;
        classes: number;
        methods: number;
        abilities: number;
        components: number;
        lifecycleMethods: number;
        uiCallbacks: number;
        navigations: number;
        nullDereferences: number;
        resourceLeaks: number;
        taintLeaks: number;
        sources: number;
        sinks: number;
        reachedStatements: number;
        reachedFacts: number;
    };
    abilities: AbilityRecord[];
    components: ComponentRecord[];
    navigations: NavigationRecord[];
    dummyMain: DummyMainRecord;
    nullness: {
        enabled: boolean;
        success: boolean;
        entryMethod: string;
        diagnostics: NullnessDiagnosticRecord[];
        reachedStatements: number;
        reachedFacts: number;
        error?: string;
    };
    resourceAnalysis: {
        enabled: boolean;
        success: boolean;
        entryMethod: string;
        resourceLeaks: ResourceLeakRecord[];
        taintLeaks: TaintLeakRecord[];
        reachedStatements: number;
        reachedFacts: number;
        sources: SourceSinkLocationRecord[];
        sinks: SourceSinkLocationRecord[];
        analyzedMethods: number;
        solverStatistics?: Readonly<IFDSSolverStatistics>;
        methodLocal: {
            leaks: MethodLocalResourceLeakRecord[];
            analyzedMethods: number;
            sourceCount: number;
            sinkCount: number;
        };
        error?: string;
    };
    duration: {
        sceneBuilding: number;
        lifecycleModeling: number;
        navigationAnalysis: number;
        nullnessAnalysis: number;
        resourceAnalysis: number;
        total: number;
    };
    warnings: string[];
    errors: string[];
}

export interface AbilityRecord {
    name: string;
    className: string;
    isEntry: boolean;
    lifecycleMethods: string[];
    filePath: string;
}

export interface ComponentRecord {
    name: string;
    className: string;
    isEntry: boolean;
    lifecycleMethods: string[];
    uiCallbacks: Array<{
        eventType: string;
        methodName: string;
        componentType: string;
    }>;
    filePath: string;
}

export interface NavigationRecord {
    source: string;
    target: string;
    type: string;
    method: string;
}

export interface DummyMainRecord {
    methodSignature: string;
    blocks: number;
    statements: number;
    lifecycleCalls: number;
    uiCallbackCalls: number;
}

const DEFAULT_OPTIONS: Required<Omit<ProjectAnalysisOptions, 'sdkRoot' | 'sdkPaths'>> = {
    inferTypes: true,
    extractUICallbacks: true,
    analyzeNavigation: true,
    runNullness: true,
    runResourceAnalysis: true,
    lifecycleModel: DEFAULT_LIFECYCLE_MODEL_MODE,
    maxCallbackIterations: DEFAULT_LIFECYCLE_CONFIG.bounds.maxCallbackIterations,
    maxAbilitiesPerFlow: DEFAULT_LIFECYCLE_CONFIG.bounds.maxAbilitiesPerFlow,
    maxNavigationHops: DEFAULT_LIFECYCLE_CONFIG.bounds.maxNavigationHops,
    maxAccessPathLength: 5,
    maxPropagationDepth: 40,
    reportUnresolvedReturns: false,
    collectSolverStatistics: false,
    verbose: false,
};

/** Complete CLI-facing application service for lifecycle, resource and nullness analysis. */
export class ProjectAnalyzer {
    private readonly options: Required<Omit<ProjectAnalysisOptions, 'sdkRoot' | 'sdkPaths'>> &
        Pick<ProjectAnalysisOptions, 'sdkRoot' | 'sdkPaths'>;
    private readonly warnings: string[] = [];

    constructor(options: ProjectAnalysisOptions = {}) {
        this.options = {
            ...DEFAULT_OPTIONS,
            ...options,
            sdkPaths: options.sdkPaths ? [...options.sdkPaths] : undefined,
        };
        this.validateBounds();
    }

    async analyze(projectPath: string): Promise<ProjectAnalysisResult> {
        this.warnings.length = 0;
        const totalStart = Date.now();
        const resolvedProjectPath = path.resolve(projectPath);
        this.validateProjectPath(resolvedProjectPath);
        const sdks = this.discoverSdks();

        const sceneStart = Date.now();
        const scene = this.buildScene(resolvedProjectPath, sdks);
        const sceneBuilding = Date.now() - sceneStart;

        const lifecycleStart = Date.now();
        const creator = this.withLifecycleConsole(() => {
            const lifecycleCreator = createLifecycleModelCreator(scene, this.options.lifecycleModel, {
                lifecycleOrder: NULLNESS_LIFECYCLE_ORDER,
                enableViewTreeParsing: this.options.extractUICallbacks,
                bounds: {
                    maxCallbackIterations: this.options.maxCallbackIterations,
                    maxAbilitiesPerFlow: this.options.maxAbilitiesPerFlow,
                    maxNavigationHops: this.options.maxNavigationHops,
                },
            });
            lifecycleCreator.create();
            return lifecycleCreator;
        });
        const lifecycleModeling = Date.now() - lifecycleStart;

        const abilities = creator.getAbilities();
        const components = creator.getComponents();
        const dummyMain = creator.getDummyMain();

        const navigationStart = Date.now();
        const navigations = this.options.analyzeNavigation
            ? this.withLifecycleConsole(() => this.collectNavigations(scene, abilities, components))
            : [];
        const navigationAnalysis = Date.now() - navigationStart;

        const resourceStart = Date.now();
        let resourceResult: ReturnType<TaintAnalysisRunner['runWithDummyMain']> | null = null;
        let methodLocalDetector: ResourceLeakDetector | null = null;
        let methodLocalLeaks: ReturnType<ResourceLeakDetector['detect']> = [];
        let scannedLocations: ReturnType<SourceSinkLocationScanner['scan']> = {
            sources: [],
            sinks: [],
        };
        let resourceError: string | undefined;
        try {
            if (this.options.runResourceAnalysis) {
                resourceResult = new TaintAnalysisRunner(scene, {
                    maxCallbackIterations: this.options.maxCallbackIterations,
                    maxAbilitiesPerFlow: this.options.maxAbilitiesPerFlow,
                    maxNavigationHops: this.options.maxNavigationHops,
                    maxPropagationDepth: this.options.maxPropagationDepth,
                    collectSolverStatistics: this.options.collectSolverStatistics,
                }).runWithDummyMain(dummyMain, creator.getAbilityMethodSet());
                methodLocalDetector = new ResourceLeakDetector(scene);
                methodLocalLeaks = methodLocalDetector.detect();
                scannedLocations = new SourceSinkLocationScanner(scene).scan();
            }
        } catch (error) {
            resourceError = error instanceof Error ? error.message : String(error);
        }
        const resourceAnalysis = Date.now() - resourceStart;

        const nullnessStart = Date.now();
        const nullnessResult = this.options.runNullness
            ? new NullnessAnalysisRunner(scene, {
                problem: {
                    maxAccessPathLength: this.options.maxAccessPathLength,
                    maxPropagationDepth: this.options.maxPropagationDepth,
                    reportUnresolvedReturns: this.options.reportUnresolvedReturns,
                },
            }).runWithDummyMain(dummyMain)
            : null;
        const nullnessAnalysis = Date.now() - nullnessStart;

        const diagnostics = (nullnessResult?.diagnostics ?? []).map(diagnostic => ({
            nullness: diagnostic.nullness,
            accessPath: diagnostic.accessPath.toString(),
            description: diagnostic.description,
            confidence: diagnostic.confidence,
            source: this.location(resolvedProjectPath, diagnostic.sourceLocation),
            dereference: this.location(resolvedProjectPath, diagnostic.dereferenceLocation),
        }));
        const reachedStatements = nullnessResult?.reachedFacts.size ?? 0;
        const reachedFacts = nullnessResult
            ? [...nullnessResult.reachedFacts.values()].reduce((sum, facts) => sum + facts.length, 0)
            : 0;
        const nullnessSuccess = nullnessResult?.success ?? !this.options.runNullness;
        const resourceSuccess = !this.options.runResourceAnalysis ||
            (resourceResult?.success === true && resourceError === undefined);
        const errors = [
            ...(!nullnessSuccess && nullnessResult?.error ? [nullnessResult.error] : []),
            ...(!resourceSuccess && resourceResult?.error ? [resourceResult.error] : []),
            ...(!resourceSuccess && resourceError ? [resourceError] : []),
        ];
        const resourceLeaks = (resourceResult?.resourceLeaks ?? []).map(leak => ({
            sourceId: leak.source.id,
            resourceType: leak.resourceType,
            expectedSink: leak.expectedSink,
            description: leak.description,
            source: this.location(
                resolvedProjectPath,
                SourceSinkLocationScanner.getLocationForStmt(scene, leak.sourceStmt)
            ),
        }));
        const taintLeaks = (resourceResult?.taintLeaks ?? []).map(leak => ({
            sourceId: leak.source.id,
            description: leak.description,
            source: this.location(
                resolvedProjectPath,
                SourceSinkLocationScanner.getLocationForStmt(scene, leak.sourceStmt)
            ),
            sink: this.location(
                resolvedProjectPath,
                SourceSinkLocationScanner.getLocationForStmt(scene, leak.sinkStmt)
            ),
            propagationPath: leak.propagationPath.map(stmt => this.location(
                resolvedProjectPath,
                SourceSinkLocationScanner.getLocationForStmt(scene, stmt)
            )),
        }));
        const resourceReachedStatements = resourceResult?.reachedFacts.size ?? 0;
        const resourceReachedFacts = resourceResult?.statistics.totalFacts ?? 0;
        const sourceLocations = scannedLocations.sources.map(source => ({
            resourceType: source.resourceType,
            methodPattern: source.methodPattern,
            methodSignature: source.methodSig,
            location: this.location(resolvedProjectPath, source),
        }));
        const sinkLocations = scannedLocations.sinks.map(sink => ({
            resourceType: sink.resourceType,
            methodPattern: sink.methodPattern,
            methodSignature: sink.methodSig,
            location: this.location(resolvedProjectPath, sink),
        }));
        const projectFiles = scene.getFiles().filter(file => {
            const filePath = file.getFilePath();
            return filePath.length > 0 &&
                this.isInside(resolvedProjectPath, path.resolve(filePath));
        }).length;

        return {
            schemaVersion: 1,
            analysisKind: 'lifecycle-nullness',
            status: errors.length === 0 ? 'success' : 'failed',
            project: {
                path: resolvedProjectPath,
                name: path.basename(resolvedProjectPath),
                analyzedAt: new Date().toISOString(),
            },
            settings: {
                sdkPaths: sdks.map(sdk => sdk.path),
                inferTypes: this.options.inferTypes,
                extractUICallbacks: this.options.extractUICallbacks,
                analyzeNavigation: this.options.analyzeNavigation,
                runNullness: this.options.runNullness,
                runResourceAnalysis: this.options.runResourceAnalysis,
                lifecycleModel: this.options.lifecycleModel,
                bounds: {
                    maxCallbackIterations: this.options.maxCallbackIterations,
                    maxAbilitiesPerFlow: this.options.maxAbilitiesPerFlow,
                    maxNavigationHops: this.options.maxNavigationHops,
                    maxAccessPathLength: this.options.maxAccessPathLength,
                    maxPropagationDepth: this.options.maxPropagationDepth,
                },
                boundEnforcement: {
                    maxCallbackIterations: this.options.lifecycleModel === 'bounded-unroll'
                        ? 'enforced'
                        : 'inactive-with-cyclic-model',
                    maxAbilitiesPerFlow: this.options.runResourceAnalysis
                        ? 'enforced'
                        : 'inactive-without-resource-analysis',
                    maxNavigationHops: this.options.runResourceAnalysis
                        ? 'enforced'
                        : 'inactive-without-resource-analysis',
                    maxAccessPathLength: 'enforced',
                    maxPropagationDepth: 'enforced',
                },
                reportUnresolvedReturns: this.options.reportUnresolvedReturns,
                collectSolverStatistics: this.options.collectSolverStatistics,
            },
            summary: {
                projectFiles,
                sceneFiles: scene.getFiles().length,
                classes: scene.getClasses().length,
                methods: scene.getMethods().length,
                abilities: abilities.length,
                components: components.length,
                lifecycleMethods: this.countLifecycleMethods(abilities, components),
                uiCallbacks: components.reduce((sum, component) =>
                    sum + component.uiCallbacks.length, 0),
                navigations: navigations.length,
                nullDereferences: diagnostics.length,
                resourceLeaks: resourceLeaks.length,
                taintLeaks: taintLeaks.length,
                sources: sourceLocations.length,
                sinks: sinkLocations.length,
                reachedStatements,
                reachedFacts,
            },
            abilities: abilities.map(ability => this.abilityRecord(ability)),
            components: components.map(component => this.componentRecord(component)),
            navigations,
            dummyMain: this.dummyMainRecord(dummyMain, abilities, components),
            nullness: {
                enabled: this.options.runNullness,
                success: nullnessSuccess,
                entryMethod: nullnessResult?.entryMethod ?? '',
                diagnostics,
                reachedStatements,
                reachedFacts,
                ...(nullnessResult?.error ? { error: nullnessResult.error } : {}),
            },
            resourceAnalysis: {
                enabled: this.options.runResourceAnalysis,
                success: resourceSuccess,
                entryMethod: resourceResult?.entryMethod ?? '',
                resourceLeaks,
                taintLeaks,
                reachedStatements: resourceReachedStatements,
                reachedFacts: resourceReachedFacts,
                sources: sourceLocations,
                sinks: sinkLocations,
                analyzedMethods: resourceResult?.statistics.analyzedMethods ?? 0,
                ...(resourceResult?.statistics.solver
                    ? { solverStatistics: resourceResult.statistics.solver }
                    : {}),
                methodLocal: {
                    leaks: methodLocalLeaks,
                    analyzedMethods: methodLocalDetector?.getAnalyzedMethodCount() ?? 0,
                    sourceCount: methodLocalDetector?.getSourceCount() ?? 0,
                    sinkCount: methodLocalDetector?.getSinkCount() ?? 0,
                },
                ...((resourceResult?.error ?? resourceError)
                    ? { error: resourceResult?.error ?? resourceError }
                    : {}),
            },
            duration: {
                sceneBuilding,
                lifecycleModeling,
                navigationAnalysis,
                nullnessAnalysis,
                resourceAnalysis,
                total: Date.now() - totalStart,
            },
            warnings: [...this.warnings],
            errors,
        };
    }

    private buildScene(projectPath: string, sdks: Sdk[]): Scene {
        const config = new SceneConfig();
        config.buildConfig(path.basename(projectPath), projectPath, sdks);
        config.buildFromProjectDir(projectPath);
        const scene = new Scene();
        scene.buildSceneFromProjectDir(config);
        if (this.options.inferTypes) scene.inferTypes();
        return scene;
    }

    private discoverSdks(): Sdk[] {
        const explicitPaths = this.options.sdkPaths?.map(sdk => path.resolve(sdk)) ?? [];
        const defaultRoot = path.resolve(__dirname, '../../sdk/default');
        const sdkRoot = explicitPaths.length === 0
            ? path.resolve(this.options.sdkRoot ?? defaultRoot)
            : undefined;
        const candidates: Array<[string, string]> = sdkRoot
            ? [
                ['ohosSdk', path.join(sdkRoot, 'openharmony/ets')],
                ['hmsSdk', path.join(sdkRoot, 'hms/ets')],
            ]
            : explicitPaths.map((sdk, index) => [`sdk${index + 1}`, sdk]);
        const result: Sdk[] = [];
        const seen = new Set<string>();
        for (const [name, candidate] of candidates) {
            if (!fs.existsSync(candidate)) {
                if (sdkRoot) continue;
                throw new Error(`SDK path does not exist: ${candidate}`);
            }
            if (!fs.statSync(candidate).isDirectory()) {
                throw new Error(`SDK path is not a directory: ${candidate}`);
            }
            const resolved = path.resolve(candidate);
            if (!seen.has(resolved)) {
                seen.add(resolved);
                result.push({ name, path: resolved, moduleName: '' });
            }
        }
        if (result.length === 0) {
            throw new Error(sdkRoot
                ? `No ETS SDK found below ${sdkRoot}; expected openharmony/ets or hms/ets`
                : 'No usable ETS SDK was provided');
        }
        return result;
    }

    private collectNavigations(
        scene: Scene,
        abilities: AbilityInfo[],
        components: ComponentInfo[]
    ): NavigationRecord[] {
        const analyzer = new NavigationAnalyzer(scene);
        analyzer.setComponentMap(components);
        const records: NavigationRecord[] = [];
        const seen = new Set<string>();
        for (const item of [...abilities, ...components]) {
            const result = analyzer.analyzeClass(item.arkClass);
            for (const warning of result.warnings) {
                this.warnings.push(`${item.name}: ${warning}`);
            }
            if (result.initialPage) {
                this.addNavigation(records, seen, {
                    source: item.name,
                    target: result.initialPage,
                    type: 'loadContent',
                    method: 'onWindowStageCreate',
                });
            }
            for (const target of result.navigationTargets) {
                this.addNavigation(records, seen, {
                    source: item.name,
                    target: target.targetAbilityName || 'unknown',
                    type: String(target.navigationType),
                    method: target.sourceMethod.getName(),
                });
            }
        }
        return records;
    }

    private addNavigation(records: NavigationRecord[], seen: Set<string>, record: NavigationRecord): void {
        const key = `${record.source}\u0000${record.target}\u0000${record.type}\u0000${record.method}`;
        if (!seen.has(key)) {
            seen.add(key);
            records.push(record);
        }
    }

    private abilityRecord(ability: AbilityInfo): AbilityRecord {
        return {
            name: ability.name,
            className: ability.arkClass.getName(),
            isEntry: ability.isEntry,
            lifecycleMethods: [...ability.lifecycleMethods.keys()].map(String),
            filePath: ability.arkClass.getDeclaringArkFile().getFilePath(),
        };
    }

    private componentRecord(component: ComponentInfo): ComponentRecord {
        return {
            name: component.name,
            className: component.arkClass.getName(),
            isEntry: component.isEntry,
            lifecycleMethods: [...component.lifecycleMethods.keys()].map(String),
            uiCallbacks: component.uiCallbacks.map(callback => ({
                eventType: String(callback.eventType),
                methodName: callback.callbackMethod.getName(),
                componentType: callback.componentType,
            })),
            filePath: component.arkClass.getDeclaringArkFile().getFilePath(),
        };
    }

    private dummyMainRecord(
        dummyMain: ReturnType<LifecycleModelCreator['getDummyMain']>,
        abilities: AbilityInfo[],
        components: ComponentInfo[]
    ): DummyMainRecord {
        const cfg = dummyMain.getCfg();
        if (!cfg) throw new Error('Lifecycle DummyMain has no CFG');
        const lifecycleNames = new Set([
            ...abilities.flatMap(ability => [...ability.lifecycleMethods.values()].map(method => method.getName())),
            ...components.flatMap(component => [...component.lifecycleMethods.values()].map(method => method.getName())),
        ]);
        const callbackNames = new Set(components.flatMap(component =>
            component.uiCallbacks.map(callback => callback.callbackMethod.getName())
        ));
        let statements = 0;
        let lifecycleCalls = 0;
        let uiCallbackCalls = 0;
        for (const block of cfg.getBlocks()) {
            for (const stmt of block.getStmts()) {
                statements++;
                const methodName = stmt.getInvokeExpr()?.getMethodSignature()
                    .getMethodSubSignature().getMethodName();
                if (methodName && lifecycleNames.has(methodName)) lifecycleCalls++;
                if (methodName && callbackNames.has(methodName)) uiCallbackCalls++;
            }
        }
        return {
            methodSignature: dummyMain.getSignature().toString(),
            blocks: cfg.getBlocks().size,
            statements,
            lifecycleCalls,
            uiCallbackCalls,
        };
    }

    private countLifecycleMethods(abilities: AbilityInfo[], components: ComponentInfo[]): number {
        return abilities.reduce((sum, ability) => sum + ability.lifecycleMethods.size, 0) +
            components.reduce((sum, component) => sum + component.lifecycleMethods.size, 0);
    }

    private location(
        projectPath: string,
        value: { filePath: string; line: number; col: number }
    ): AnalysisLocation {
        const filePath = path.resolve(value.filePath);
        return {
            filePath,
            relativePath: this.isInside(projectPath, filePath)
                ? path.relative(projectPath, filePath).split(path.sep).join('/')
                : filePath,
            line: value.line,
            col: value.col,
        };
    }

    private isInside(parent: string, child: string): boolean {
        const relative = path.relative(parent, child);
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    }

    private validateProjectPath(projectPath: string): void {
        if (!fs.existsSync(projectPath)) throw new Error(`Project path does not exist: ${projectPath}`);
        if (!fs.statSync(projectPath).isDirectory()) {
            throw new Error(`Project path is not a directory: ${projectPath}`);
        }
    }

    private validateBounds(): void {
        for (const [name, value] of [
            ['maxCallbackIterations', this.options.maxCallbackIterations],
            ['maxAccessPathLength', this.options.maxAccessPathLength],
            ['maxPropagationDepth', this.options.maxPropagationDepth],
        ] as const) {
            if (!Number.isInteger(value) || value < 1) {
                throw new Error(`${name} must be a positive integer: ${value}`);
            }
        }
        for (const [name, value] of [
            ['maxAbilitiesPerFlow', this.options.maxAbilitiesPerFlow],
            ['maxNavigationHops', this.options.maxNavigationHops],
        ] as const) {
            if (!Number.isInteger(value) || value < 0) {
                throw new Error(`${name} must be a non-negative integer: ${value}`);
            }
        }
    }

    private withLifecycleConsole<T>(operation: () => T): T {
        if (this.options.verbose) return operation();
        const originalLog = console.log;
        const originalWarn = console.warn;
        console.log = () => undefined;
        console.warn = (...args: unknown[]) => {
            this.warnings.push(args.map(String).join(' '));
        };
        try {
            return operation();
        } finally {
            console.log = originalLog;
            console.warn = originalWarn;
        }
    }
}
