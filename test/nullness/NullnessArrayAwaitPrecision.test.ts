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
        '../fixtures/nullness/array-await-precision'
    );
    const config = new SceneConfig();
    config.buildConfig(projectPath, projectPath, [sdk]);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

describe('Nullness array and await precision', () => {
    it('reports nullable elements and await results without contaminating safe peers', () => {
        const result = new NullnessAnalysisRunner(buildScene()).runFromDummyMain();

        expect(result.success, result.error).toBe(true);
        const dereferences = result.diagnostics.map(diagnostic =>
            diagnostic.dereferenceStmt.getOriginalText()
        );
        expect(dereferences.some(text => text?.includes('accounts[0]!.refresh()'))).toBe(true);
        expect(dereferences.some(text => text?.includes('nullableAccount!.refresh()'))).toBe(true);
        expect(dereferences.some(text => text?.includes('accounts[1]!.refresh()'))).toBe(false);
        expect(dereferences.some(text => text?.includes('safeAccount.refresh()'))).toBe(false);
        expect(result.diagnostics).toHaveLength(2);
    });
});
