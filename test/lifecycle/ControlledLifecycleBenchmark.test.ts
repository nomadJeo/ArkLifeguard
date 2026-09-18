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

const diagnosticsByProject = new Map<string, readonly NullDereferenceDiagnostic[]>();
const blocksByProject = new Map<string, BasicBlock[]>();

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

function runFlatNullness(project: string): readonly NullDereferenceDiagnostic[] {
    const cached = diagnosticsByProject.get(project);
    if (cached) return cached;
    const result = new NullnessAnalysisRunner(buildControlledScene(project), {
        lifecycleModel: 'flat',
    }).runFromDummyMain();
    expect(result.success, result.error).toBe(true);
    diagnosticsByProject.set(project, result.diagnostics);
    return result.diagnostics;
}

function hasDiagnostic(
    diagnostics: ReturnType<typeof runFlatNullness>,
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

function flatBlocks(project: string): BasicBlock[] {
    const cached = blocksByProject.get(project);
    if (cached) return cached;
    const creator = createLifecycleModelCreator(
        buildControlledScene(project),
        'flat'
    );
    creator.create();
    const blocks = [...creator.getDummyMain().getCfg()!.getBlocks()];
    blocksByProject.set(project, blocks);
    return blocks;
}

/** Reach the next callback without crossing another callback invocation. */
function hasImmediateTransition(project: string, from: string, to: string): boolean {
    const blocks = flatBlocks(project);
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

describe('current M0 flat observations', () => {
    it.each(nullnessCases)('$id matches its flat nullness oracle', item => {
        const diagnostics = runFlatNullness(item.project);
        expect(hasDiagnostic(
            diagnostics,
            item.source,
            item.dereference
        )).toBe(item.expected.flat);
    });

    it.each(transitionCases)('$id matches its flat transition oracle', item => {
        expect(hasImmediateTransition(item.project, item.from, item.to))
            .toBe(item.expected.flat);
    });
});
