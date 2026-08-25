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
    const projectPath = path.join(__dirname, '../fixtures/nullness/array-find-summary');
    const config = new SceneConfig();
    config.buildConfig(projectPath, projectPath, [sdk]);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

describe('Nullness Array.find summary', () => {
    it('reports an asserted find result while honoring a truthiness guard', () => {
        const result = new NullnessAnalysisRunner(buildScene()).runFromDummyMain();

        expect(result.success, result.error).toBe(true);
        const findDiagnostics = result.diagnostics.filter(diagnostic =>
            diagnostic.dereferenceStmt.getOriginalText()?.includes('.find(')
        );
        expect(findDiagnostics).toHaveLength(1);
        expect(findDiagnostics[0].nullness).toBe('maybe-undefined');
        expect(result.diagnostics.some(diagnostic =>
            diagnostic.dereferenceStmt.getOriginalText()?.includes('guarded.refresh()')
        )).toBe(false);
    });
});
