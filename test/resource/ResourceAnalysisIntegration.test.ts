import { beforeAll, describe, expect, it } from 'vitest';
import { createLifecycleModelCreator, LifecycleModelCreator } from '../../src/lifecycle';
import {
    ResourceLeakDetector,
    FileLeakSuppressor,
    LifecycleLeakSuppressor,
    SourceSinkLocationScanner,
    SourceSinkManager,
    TaintAnalysisRunner,
} from '../../src/analysis/resource';
import { buildResourceScene } from '../helpers/buildScene';
import type { Scene } from '../../src/adapter/arkanalyzer';

describe('resource analysis integration', () => {
    let scene: Scene;

    beforeAll(() => {
        scene = buildResourceScene('source-sink');
    });

    it('scans real ArkIR source and sink locations', () => {
        const locations = new SourceSinkLocationScanner(scene).scan();

        expect(locations.sources.filter(item => item.resourceType === 'AVPlayer')).toHaveLength(2);
        expect(locations.sinks.some(item => item.methodPattern === 'AVPlayer.release')).toBe(true);
        expect(locations.sources.every(item => item.line > 0)).toBe(true);
    });

    it('retains one method-local leak and recognizes the released resource', () => {
        const detector = new ResourceLeakDetector(scene);
        const leaks = detector.detect().filter(leak => leak.resourceType === 'AVPlayer');

        expect(detector.getSourceCount()).toBeGreaterThanOrEqual(4);
        expect(detector.getSinkCount()).toBeGreaterThanOrEqual(1);
        expect(leaks).toHaveLength(1);
        expect(leaks[0]?.methodName).toBe('onCreate');
    });

    it('preserves the migrated one-shot timer and file-close suppressors', () => {
        const manager = new SourceSinkManager();
        const findSourceStmt = (methodName: string) => {
            for (const method of scene.getMethods()) {
                for (const stmt of method.getCfg()?.getStmts() ?? []) {
                    const invoked = stmt.getInvokeExpr()?.getMethodSignature()
                        .getMethodSubSignature().getMethodName();
                    if (invoked === methodName) return stmt;
                }
            }
            throw new Error(`missing source statement: ${methodName}`);
        };

        const timerStmt = findSourceStmt('setInterval');
        const timerSource = manager.isSource({ className: 'TimerApi', methodName: 'setInterval' });
        expect(timerSource).not.toBeNull();
        expect(LifecycleLeakSuppressor.filterSuppressedTimerLeaks(scene, [{
            source: timerSource!,
            sourceStmt: timerStmt,
            resourceType: 'IntervalTimer',
            expectedSink: 'clearInterval',
            description: 'test timer leak',
        }])).toEqual([]);

        const fileStmt = findSourceStmt('openSync');
        const fileSource = manager.isSource({ className: 'FileApi', methodName: 'openSync' });
        expect(fileSource).not.toBeNull();
        expect(FileLeakSuppressor.filterSuppressedFileLeaks(scene, [{
            source: fileSource!,
            sourceStmt: fileStmt,
            resourceType: 'File',
            expectedSink: 'closeSync',
            description: 'test file leak',
        }])).toEqual([]);
    });

    it('runs the migrated bounded IFDS analysis from the existing DummyMain', () => {
        const creator = new LifecycleModelCreator(scene, {
            bounds: {
                maxCallbackIterations: 1,
                maxAbilitiesPerFlow: 3,
                maxNavigationHops: 5,
            },
        });
        creator.create();

        const result = new TaintAnalysisRunner(scene, {
            maxCallbackIterations: 1,
            maxAbilitiesPerFlow: 3,
            maxNavigationHops: 5,
            maxPropagationDepth: 40,
        }).runWithDummyMain(creator.getDummyMain(), creator.getAbilityMethodSet());

        expect(result.success).toBe(true);
        expect(result.statistics.sourceCount).toBeGreaterThan(0);
        expect(result.statistics.sinkCount).toBeGreaterThan(0);
        expect(result.statistics.totalFacts).toBeGreaterThan(0);
        expect(result.resourceLeaks.some(leak => leak.resourceType === 'AVPlayer')).toBe(true);
    });

    it('treats zero Ability and navigation budgets as disabled', () => {
        const unboundedScene = buildResourceScene('unbounded-navigation');
        const creator = createLifecycleModelCreator(unboundedScene, 'flat');
        creator.create();

        const result = new TaintAnalysisRunner(unboundedScene, {
            maxAbilitiesPerFlow: 0,
            maxNavigationHops: 0,
            maxPropagationDepth: 40,
        }).runWithDummyMain(creator.getDummyMain(), creator.getAbilityMethodSet());

        expect(result.success).toBe(true);
        expect(result.statistics.sourceCount).toBeGreaterThan(0);
        expect(result.statistics.sinkCount).toBeGreaterThan(0);
        expect(result.resourceLeaks.some(leak => leak.resourceType === 'AVPlayer')).toBe(false);

        const bounded = new TaintAnalysisRunner(unboundedScene, {
            maxAbilitiesPerFlow: 0,
            maxNavigationHops: 1,
            maxPropagationDepth: 40,
        }).runWithDummyMain(creator.getDummyMain(), creator.getAbilityMethodSet());
        expect(bounded.resourceLeaks.some(leak => leak.resourceType === 'AVPlayer')).toBe(true);
    });
});
