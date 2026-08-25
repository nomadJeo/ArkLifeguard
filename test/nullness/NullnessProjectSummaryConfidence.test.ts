import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Sdk } from '../../src/adapter/arkanalyzer';
import { Scene, SceneConfig } from '../../src/adapter/arkanalyzer';
import { NullnessAnalysisRunner } from '../../src/analysis/nullness';

const sdk: Sdk = {
    name: '',
    path: path.join(__dirname, '../fixtures/sdk'),
    moduleName: '',
};

function buildScene(): Scene {
    const projectPath = path.join(
        __dirname,
        '../fixtures/nullness/project-summary-confidence'
    );
    const config = new SceneConfig();
    config.buildConfig(projectPath, projectPath, [sdk]);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

describe('project return summaries and evidence confidence', () => {
    it('resolves imported functions and keeps guarded field reloads safe', () => {
        const result = new NullnessAnalysisRunner(buildScene()).runFromDummyMain();

        expect(result.success, result.error).toBe(true);
        const reports = result.diagnostics.map(diagnostic => ({
            source: diagnostic.sourceStmt.getOriginalText(),
            sink: diagnostic.dereferenceStmt.getOriginalText(),
            confidence: diagnostic.confidence,
        }));
        expect(reports).toHaveLength(2);
        expect(reports.some(report =>
            report.source?.includes('return null') &&
            report.sink?.includes('selected!.refresh()') &&
            report.confidence === 'high'
        )).toBe(true);
        expect(reports.some(report =>
            report.source?.includes('return uninitializedModuleAccount') &&
            report.sink?.includes('moduleMissing!.refresh()') &&
            report.confidence === 'high'
        )).toBe(true);
        expect(reports.some(report =>
            report.sink?.includes('moduleStable.refresh()')
        )).toBe(false);
        expect(reports.some(report => report.sink?.includes('assigned.refresh()'))).toBe(false);
        expect(reports.some(report => report.sink?.includes('loopInitialized.refresh()'))).toBe(false);
        expect(reports.some(report => report.sink?.includes('required.refresh()'))).toBe(false);
    });

    it('can expose unresolved calls separately as low-confidence evidence', () => {
        const result = new NullnessAnalysisRunner(buildScene(), {
            problem: { reportUnresolvedReturns: true },
        }).runFromDummyMain();

        expect(result.success, result.error).toBe(true);
        const unresolved = result.diagnostics.find(diagnostic =>
            diagnostic.dereferenceStmt.getOriginalText()?.includes('unknownValue!.refresh()')
        );
        expect(unresolved?.confidence).toBe('low');
    });
});
