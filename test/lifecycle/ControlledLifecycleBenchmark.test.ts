import { describe, expect, it } from 'vitest';
import 'arkanalyzer';
import path from 'node:path';
import { BasicBlock, Scene, SceneConfig } from '../../src/adapter/arkanalyzer';
import type { Sdk } from 'arkanalyzer/lib/Config';
import {
    NullDereferenceDiagnostic,
    NullnessAnalysisRunner,
} from '../../src/analysis/nullness';
import { createLifecycleModelCreator } from '../../src/lifecycle';
import {
    CONTROLLED_LIFECYCLE_ROOT,
    CONTROLLED_LIFECYCLE_CASES,
    NullnessBenchmarkCase,
    PrecisionLevel,
    ResearchLifecycleModel,
    TransitionBenchmarkCase,
} from './ControlledLifecycleBenchmarkOracle';

type ImplementedLifecycleModel = Extract<ResearchLifecycleModel, 'flat' | 'hierarchical'>;

const IMPLEMENTED_MODELS: readonly ImplementedLifecycleModel[] = [
    'flat',
    'hierarchical',
];
const diagnosticsByModelAndProject = new Map<
    string,
    readonly NullDereferenceDiagnostic[]
>();
const blocksByModelAndProject = new Map<string, BasicBlock[]>();

const SDK_DIR = path.join(__dirname, '../fixtures/sdk');
const sdk: Sdk = { name: 'test-sdk', path: SDK_DIR, moduleName: '' };

function buildControlledScene(project: string): Scene {
    const projectPath = path.join(CONTROLLED_LIFECYCLE_ROOT, project);
    const config = new SceneConfig();
    config.buildConfig(projectPath, projectPath, [sdk]);
    config.buildFromProjectDir(projectPath);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

function cacheKey(model: ImplementedLifecycleModel, project: string): string {
    return `${model}:${project}`;
}

function runNullness(
    model: ImplementedLifecycleModel,
    project: string
): readonly NullDereferenceDiagnostic[] {
    const key = cacheKey(model, project);
    const cached = diagnosticsByModelAndProject.get(key);
    if (cached) return cached;
    const result = new NullnessAnalysisRunner(buildControlledScene(project), {
        lifecycleModel: model,
    }).runFromDummyMain();
    expect(result.success, result.error).toBe(true);
    diagnosticsByModelAndProject.set(key, result.diagnostics);
    return result.diagnostics;
}

function hasDiagnostic(
    diagnostics: readonly NullDereferenceDiagnostic[],
    source: string,
    dereference: string
): boolean {
    return diagnostics.some(diagnostic =>
        diagnostic.sourceStmt.getOriginalText()?.includes(source) === true &&
        diagnostic.dereferenceStmt.getOriginalText()?.includes(dereference) === true
    );
}

function blockInvokes(block: BasicBlock, methodName: string): boolean {
    return block.getStmts().some(stmt => stmt.getInvokeExpr()
        ?.getMethodSignature().getMethodSubSignature().getMethodName() === methodName);
}

function modelBlocks(
    model: ImplementedLifecycleModel,
    project: string
): BasicBlock[] {
    const key = cacheKey(model, project);
    const cached = blocksByModelAndProject.get(key);
    if (cached) return cached;
    const creator = createLifecycleModelCreator(
        buildControlledScene(project),
        model
    );
    creator.create();
    const blocks = [...creator.getDummyMain().getCfg()!.getBlocks()];
    blocksByModelAndProject.set(key, blocks);
    return blocks;
}

/** Reach the next callback without crossing another callback invocation. */
function hasImmediateTransition(
    model: ImplementedLifecycleModel,
    project: string,
    from: string,
    to: string
): boolean {
    const blocks = modelBlocks(model, project);
    const source = blocks.find(block => blockInvokes(block, from));
    const target = blocks.find(block => blockInvokes(block, to));
    expect(source, `missing callback ${from}`).toBeDefined();
    expect(target, `missing callback ${to}`).toBeDefined();

    const pending = [...source!.getSuccessors()];
    const visited = new Set<BasicBlock>();
    while (pending.length > 0) {
        const block = pending.pop()!;
        if (block === target) return true;
        if (visited.has(block)) continue;
        visited.add(block);
        if (block.getStmts().some(stmt => stmt.getInvokeExpr())) continue;
        pending.push(...block.getSuccessors());
    }
    return false;
}

const nullnessCases = CONTROLLED_LIFECYCLE_CASES.filter(
    (item): item is NullnessBenchmarkCase => item.observation === 'nullness'
);
const transitionCases = CONTROLLED_LIFECYCLE_CASES.filter(
    (item): item is TransitionBenchmarkCase => item.observation === 'immediate-transition'
);

describe('controlled lifecycle benchmark oracle', () => {
    it.each(CONTROLLED_LIFECYCLE_CASES)('$id first becomes precise at $firstPreciseModel', item => {
        const models: ResearchLifecycleModel[] = [
            'flat',
            'hierarchical',
            'hierarchical-state',
        ];
        const levelIndex: Record<PrecisionLevel, number> = { M0: 0, M1: 1, M2: 2 };
        for (const [index, model] of models.entries()) {
            expect(item.expected[model] === item.semanticFeasible).toBe(
                index >= levelIndex[item.firstPreciseModel]
            );
        }
    });
});

for (const model of IMPLEMENTED_MODELS) {
    describe(`${model} observations`, () => {
        it.each(nullnessCases)(`$id matches its ${model} nullness oracle`, item => {
            const diagnostics = runNullness(model, item.project);
            expect(hasDiagnostic(
                diagnostics,
                item.source,
                item.dereference
            )).toBe(item.expected[model]);
        });

        it.each(transitionCases)(`$id matches its ${model} transition oracle`, item => {
            expect(hasImmediateTransition(model, item.project, item.from, item.to))
                .toBe(item.expected[model]);
        });
    });
}
