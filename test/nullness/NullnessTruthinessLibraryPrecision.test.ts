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
        '../fixtures/nullness/truthiness-library-precision'
    );
    const config = new SceneConfig();
    config.buildConfig(projectPath, projectPath, [sdk]);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

describe('Nullness truthiness and library precision', () => {
    it('removes guarded and non-null built-in noise without hiding unsafe exec()', () => {
        const result = new NullnessAnalysisRunner(buildScene()).runFromDummyMain();

        expect(result.success, result.error).toBe(true);
        const dereferences = result.diagnostics.map(diagnostic =>
            diagnostic.dereferenceStmt.getOriginalText()
        );
        expect(dereferences.some(text => text?.includes('guarded.refresh()'))).toBe(false);
        expect(dereferences.some(text => text?.includes('negatedGuard.refresh()'))).toBe(false);
        expect(dereferences.some(text => text?.includes('this.observers.push'))).toBe(false);
        expect(dereferences.some(text => text?.includes("normalized.startsWith('a')"))).toBe(false);
        expect(dereferences.some(text => text?.includes('match.length'))).toBe(false);
        expect(dereferences.some(text => text?.includes('match.slice()'))).toBe(false);
        expect(dereferences.some(text => text?.includes('instanceGuard.toString()'))).toBe(false);
        expect(dereferences.some(text => text?.includes('captured.refresh()'))).toBe(false);
        expect(dereferences.some(text => text?.includes('templateValue: ${templateValue}'))).toBe(false);
        expect(dereferences.some(text => text?.includes('unsafeMatch!.slice()'))).toBe(true);
        expect(dereferences.some(text => text?.includes('this.currentNode!.refresh()'))).toBe(false);
        expect(dereferences.some(text => text?.includes('this.config!.refresh()'))).toBe(false);
        expect(dereferences.some(text => text?.includes('lastMatch![0]'))).toBe(false);
        expect(result.diagnostics).toHaveLength(1);
    });
});
