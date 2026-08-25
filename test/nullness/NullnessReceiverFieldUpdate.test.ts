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
        '../fixtures/nullness/receiver-field-update'
    );
    const config = new SceneConfig();
    config.buildConfig(projectPath, projectPath, [sdk]);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

describe('Nullness receiver-field updates across calls', () => {
    it('kills a field updated by a callee and preserves an unchanged field', () => {
        const result = new NullnessAnalysisRunner(buildScene()).runFromDummyMain();

        expect(result.success, result.error).toBe(true);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].sourceStmt.getOriginalText()).toContain(
            'unsafe:'
        );
        expect(result.diagnostics[0].dereferenceStmt.getOriginalText()).toContain(
            'this.unsafe!.close()'
        );
        expect(result.diagnostics.some(diagnostic =>
            diagnostic.dereferenceStmt.getOriginalText()?.includes('this.safe!.close()')
        )).toBe(false);
        expect(result.diagnostics.some(diagnostic =>
            diagnostic.accessPath.base?.getName() === 'this' &&
            diagnostic.sourceStmt.getOriginalText()?.includes('this.optional')
        )).toBe(false);
        expect(result.diagnostics.some(diagnostic =>
            diagnostic.dereferenceStmt.getOriginalText()?.includes('this.guarded!.close()')
        )).toBe(false);
    });
});
