import { describe, expect, it } from 'vitest';
import { ProjectAnalyzer } from '../../src/application';
import { fixturePath } from '../helpers/buildScene';

describe('ProjectAnalyzer end-to-end application service', () => {
    it('runs Scene, bounded lifecycle, resource analysis, nullness and result assembly in one chain', async () => {
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
        expect(result.resourceAnalysis.success).toBe(true);
        expect(result.resourceAnalysis.analyzedMethods).toBeGreaterThan(0);
        expect(result.settings.lifecycleModel).toBe('flat');
        expect(result.settings.boundEnforcement.maxCallbackIterations)
            .toBe('inactive-with-cyclic-model');
        expect(result.settings.boundEnforcement.maxAbilitiesPerFlow).toBe('enforced');
        expect(result.settings.bounds).toEqual({
            maxCallbackIterations: 2,
            maxAbilitiesPerFlow: 4,
            maxNavigationHops: 6,
            maxAccessPathLength: 4,
            maxPropagationDepth: 30,
        });
    });

    it('serializes resource leaks and their source locations', async () => {
        const result = await new ProjectAnalyzer({
            sdkPaths: [fixturePath('sdk')],
            runNullness: false,
        }).analyze(fixturePath('resource', 'source-sink'));

        expect(result.status).toBe('success');
        expect(result.resourceAnalysis.enabled).toBe(true);
        expect(result.settings.bounds.maxAbilitiesPerFlow).toBe(0);
        expect(result.settings.bounds.maxNavigationHops).toBe(0);
        expect(result.settings.boundEnforcement.maxAbilitiesPerFlow).toBe('disabled');
        expect(result.settings.boundEnforcement.maxNavigationHops).toBe('disabled');
        expect(result.summary.resourceLeaks).toBe(1);
        expect(result.summary.sources).toBeGreaterThanOrEqual(4);
        expect(result.summary.sinks).toBeGreaterThanOrEqual(2);
        expect(result.resourceAnalysis.methodLocal.leaks.some(
            leak => leak.resourceType === 'AVPlayer' && leak.methodName === 'onCreate'
        )).toBe(true);
        expect(result.resourceAnalysis.resourceLeaks[0]).toMatchObject({
            resourceType: 'AVPlayer',
            source: { relativePath: 'EntryAbility.ets' },
        });
    });
});
