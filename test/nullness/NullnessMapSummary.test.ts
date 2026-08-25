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
    const projectPath = path.join(__dirname, '../fixtures/nullness/map-summary-precision');
    const config = new SceneConfig();
    config.buildConfig(projectPath, projectPath, [sdk]);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

describe('Nullness Map summary', () => {
    it('uses the generic container rule while excluding a project-defined get()', () => {
        const result = new NullnessAnalysisRunner(buildScene()).runFromDummyMain();

        expect(result.success, result.error).toBe(true);
        const dereferences = result.diagnostics.map(diagnostic =>
            diagnostic.dereferenceStmt.getOriginalText()
        );
        expect(dereferences.some(text => text?.includes("missingAccounts.get('missing')"))).toBe(true);
        expect(dereferences.some(text => text?.includes("knownAccounts.get('known')"))).toBe(false);
        expect(dereferences.some(text => text?.includes("guardedAccounts.get('known')"))).toBe(false);
        expect(dereferences.some(text => text?.includes("repository.get('known')"))).toBe(false);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].nullness).toBe('maybe-undefined');
    });
});
