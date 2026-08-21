import { beforeAll, describe, expect, it } from 'vitest';
import 'arkanalyzer';
import type { Scene } from 'arkanalyzer';
import { NavigationAnalyzer } from '../../src/lifecycle/NavigationAnalyzer';
import { NavigationType } from '../../src/lifecycle/LifecycleTypes';
import { buildLifecycleScene } from '../helpers/buildScene';

function getClass(scene: Scene, className: string) {
    const arkClass = scene.getClasses().find(item => item.getName() === className);
    expect(arkClass, `Expected class ${className}`).toBeDefined();
    return arkClass!;
}

describe('NavigationAnalyzer', () => {
    it('recognizes the initial page loaded by an ability', () => {
        const scene = buildLifecycleScene('simple');
        const result = new NavigationAnalyzer(scene).analyzeClass(getClass(scene, 'EntryAbility'));

        expect(result.initialPage).toBe('pages/Index');
        expect(result.navigationTargets.map(target => target.targetAbilityName)).toContain('pages/Index');
        expect(result.warnings).toEqual([]);
    });

    describe('router calls', () => {
        let scene: Scene;
        let analyzer: NavigationAnalyzer;

        beforeAll(() => {
            scene = buildLifecycleScene('router');
            analyzer = new NavigationAnalyzer(scene);
        });

        it('collects push, replace and back targets', () => {
            const result = analyzer.analyzeClass(getClass(scene, 'Index'));
            const names = result.navigationTargets.map(target => target.targetAbilityName);
            const types = new Set(result.navigationTargets.map(target => target.navigationType));

            expect(names).toEqual(expect.arrayContaining([
                'pages/Detail',
                'pages/Settings',
                '__BACK__',
            ]));
            expect(types.has(NavigationType.ROUTER_PUSH)).toBe(true);
            expect(types.has(NavigationType.ROUTER_REPLACE)).toBe(true);
            expect(types.has(NavigationType.ROUTER_BACK)).toBe(true);
        });

        it('handles direct and indirect URL construction conservatively', () => {
            const result = analyzer.analyzeClass(getClass(scene, 'DynamicRouter'));
            const names = result.navigationTargets.map(target => target.targetAbilityName);

            expect(names).toEqual(expect.arrayContaining([
                'pages/Page1',
                'pages/Page2',
                'pages/Detail',
            ]));
            expect(result.warnings.length).toBeGreaterThanOrEqual(1);
        });
    });
});
