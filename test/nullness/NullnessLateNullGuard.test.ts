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
    const projectPath = path.join(__dirname, '../fixtures/nullness/late-null-guard');
    const config = new SceneConfig();
    config.buildConfig(projectPath, projectPath, [sdk]);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

describe('Nullness late null guard', () => {
    it('reports a dereference before its null check but not a guard-first expression', () => {
        const result = new NullnessAnalysisRunner(buildScene()).runFromDummyMain();

        expect(result.success, result.error).toBe(true);
        const lateGuardDiagnostics = result.diagnostics.filter(diagnostic =>
            diagnostic.description.includes('before its null check')
        );
        expect(lateGuardDiagnostics).toHaveLength(1);
        expect(lateGuardDiagnostics[0].dereferenceStmt.getOriginalText())
            .toContain('unsafeAccount!.active');
        expect(result.diagnostics.some(diagnostic =>
            diagnostic.dereferenceStmt.getOriginalText()?.includes('safeAccount.active')
        )).toBe(false);
    });
});
