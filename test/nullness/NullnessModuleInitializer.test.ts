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
    const projectPath = path.join(__dirname, '../fixtures/nullness/module-initializer');
    const config = new SceneConfig();
    config.buildConfig(projectPath, projectPath, [sdk]);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

describe('Nullness module initializer roots', () => {
    it('analyzes a nullish source in an imported file default method', () => {
        const result = new NullnessAnalysisRunner(buildScene()).runFromDummyMain();

        expect(result.success, result.error).toBe(true);
        const diagnostics = result.diagnostics.filter(diagnostic =>
            diagnostic.dereferenceLocation.filePath.endsWith('ModuleState.ets') &&
            diagnostic.dereferenceStmt.getOriginalText()?.includes('missingAccount!.refresh()')
        );
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].nullness).toBe('null');
    });
});
