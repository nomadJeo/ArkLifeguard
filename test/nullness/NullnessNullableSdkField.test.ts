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
    const projectPath = path.join(__dirname, '../fixtures/nullness/nullable-sdk-field');
    const config = new SceneConfig();
    config.buildConfig(projectPath, projectPath, [sdk]);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

describe('Nullness nullable SDK field model', () => {
    it('models Error.stack as optional and respects a truthiness guard', () => {
        const result = new NullnessAnalysisRunner(buildScene()).runFromDummyMain();

        expect(result.success, result.error).toBe(true);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].nullness).toBe('maybe-undefined');
        expect(result.diagnostics[0].sourceStmt.getOriginalText())
            .toContain('new Error().stack');
        expect(result.diagnostics[0].dereferenceStmt.getOriginalText())
            .toContain("unsafeStack!.split('\\n')");
    });
});
