import { describe, expect, it } from 'vitest';
import { ProjectAnalyzer } from '../../src/application';
import { fixturePath } from '../helpers/buildScene';

describe('ProjectAnalyzer end-to-end application service', () => {
    it('runs Scene, bounded lifecycle, nullness and result assembly in one chain', async () => {
        const result = await new ProjectAnalyzer({
            sdkPaths: [fixturePath('sdk')],
            maxCallbackIterations: 2,
            maxAbilitiesPerFlow: 4,
            maxNavigationHops: 6,
            maxAccessPathLength: 4,
            maxPropagationDepth: 30,
        }).analyze(fixturePath('lifecycle', 'simple'));

        expect(result.status).toBe('success');
        expect(result.summary.abilities).toBe(1);
        expect(result.summary.components).toBe(1);
        expect(result.dummyMain.blocks).toBeGreaterThan(0);
        expect(result.dummyMain.statements).toBeGreaterThan(0);
        expect(result.nullness.success).toBe(true);
        expect(result.settings.bounds).toEqual({
            maxCallbackIterations: 2,
            maxAbilitiesPerFlow: 4,
            maxNavigationHops: 6,
            maxAccessPathLength: 4,
            maxPropagationDepth: 30,
        });
    });
});
