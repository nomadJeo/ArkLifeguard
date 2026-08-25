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
    const projectPath = path.join(__dirname, '../fixtures/nullness/arkui-argument-sink');
    const config = new SceneConfig();
    config.buildConfig(projectPath, projectPath, [sdk]);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

describe('Nullness ArkUI non-null argument sink', () => {
    it('reports a nullish ForEach collection without flagging a present collection', () => {
        const result = new NullnessAnalysisRunner(buildScene()).runFromDummyMain();

        expect(result.success, result.error).toBe(true);
        const diagnostics = result.diagnostics.filter(diagnostic =>
            diagnostic.dereferenceStmt.getOriginalText()?.includes('ForEach(')
        );
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].description).toContain('non-null parameter');
        expect(diagnostics[0].nullness).toBe('null');
        expect(diagnostics[0].dereferenceStmt.getOriginalText())
            .toContain('ForEach(missingItems!');
    });
});
