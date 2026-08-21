import { beforeAll, describe, expect, it } from 'vitest';
import 'arkanalyzer';
import type { Scene } from 'arkanalyzer';
import { AbilityCollector } from '../../src/lifecycle/AbilityCollector';
import { ViewTreeCallbackExtractor } from '../../src/lifecycle/ViewTreeCallbackExtractor';
import { UIEventType } from '../../src/lifecycle/LifecycleTypes';
import { buildLifecycleScene } from '../helpers/buildScene';

function getClass(scene: Scene, className: string) {
    const arkClass = scene.getClasses().find(item => item.getName() === className);
    expect(arkClass, `Expected class ${className}`).toBeDefined();
    return arkClass!;
}

describe('ViewTreeCallbackExtractor', () => {
    describe('simple project', () => {
        let scene: Scene;
        let extractor: ViewTreeCallbackExtractor;

        beforeAll(() => {
            scene = buildLifecycleScene('simple');
            extractor = new ViewTreeCallbackExtractor(scene);
        });

        it('extracts the onClick callback method', () => {
            const callbacks = extractor.extractFromComponent(getClass(scene, 'Index'));

            expect(callbacks.map(callback => callback.eventType)).toContain(UIEventType.ON_CLICK);
            expect(callbacks.map(callback => callback.callbackMethod.getName())).toContain('handleClick');
        });

        it('fills callbacks into collected components', () => {
            const components = new AbilityCollector(scene).collectAllComponents();

            extractor.fillAllComponentCallbacks(components);

            expect(components.some(component => component.uiCallbacks.length > 0)).toBe(true);
            expect(components.every(component => Array.isArray(component.uiCallbacks))).toBe(true);
        });

        it('returns no callbacks for a class without a ViewTree', () => {
            expect(extractor.extractFromComponent(getClass(scene, 'EntryAbility'))).toEqual([]);
        });
    });

    it('maps the supported UI event families', () => {
        const scene = buildLifecycleScene('complex-ui');
        const callbacks = new ViewTreeCallbackExtractor(scene)
            .extractFromComponent(getClass(scene, 'HomePage'));
        const eventTypes = new Set(callbacks.map(callback => callback.eventType));

        expect(eventTypes.has(UIEventType.ON_CLICK)).toBe(true);
        expect(eventTypes.has(UIEventType.ON_TOUCH)).toBe(true);
        expect(eventTypes.has(UIEventType.ON_CHANGE)).toBe(true);
        expect(eventTypes.has(UIEventType.ON_APPEAR)).toBe(true);
    });
});
