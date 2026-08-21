import { beforeAll, describe, expect, it } from 'vitest';
import 'arkanalyzer';
import { AbilityCollector } from '../../src/lifecycle/AbilityCollector';
import {
    AbilityLifecycleStage,
    ComponentLifecycleStage,
} from '../../src/lifecycle/LifecycleTypes';
import { buildLifecycleScene } from '../helpers/buildScene';

describe('AbilityCollector', () => {
    describe('simple project', () => {
        let collector: AbilityCollector;

        beforeAll(() => {
            collector = new AbilityCollector(buildLifecycleScene('simple'));
        });

        it('collects entry metadata from module.json5', () => {
            const abilities = collector.collectAllAbilities();
            const entryAbility = abilities.find(ability => ability.name === 'EntryAbility');

            expect(entryAbility?.isEntry).toBe(true);
            expect(collector.getEntryAbilityNames()).toContain('EntryAbility');
            expect(collector.getModuleConfigs().some(config =>
                config.mainElement === 'EntryAbility'
            )).toBe(true);
        });

        it('collects ability and component lifecycle methods', () => {
            const entryAbility = collector.collectAllAbilities()
                .find(ability => ability.name === 'EntryAbility');
            const indexComponent = collector.collectAllComponents()
                .find(component => component.name === 'Index');

            expect(entryAbility).toBeDefined();
            expect(entryAbility?.lifecycleMethods.has(AbilityLifecycleStage.CREATE)).toBe(true);
            expect(entryAbility?.lifecycleMethods.has(AbilityLifecycleStage.WINDOW_STAGE_CREATE)).toBe(true);
            expect(entryAbility?.lifecycleMethods.has(AbilityLifecycleStage.FOREGROUND)).toBe(true);
            expect(entryAbility?.lifecycleMethods.has(AbilityLifecycleStage.BACKGROUND)).toBe(true);
            expect(entryAbility?.lifecycleMethods.has(AbilityLifecycleStage.DESTROY)).toBe(true);

            expect(indexComponent?.isEntry).toBe(true);
            expect(indexComponent?.lifecycleMethods.has(ComponentLifecycleStage.ABOUT_TO_APPEAR)).toBe(true);
            expect(indexComponent?.lifecycleMethods.has(ComponentLifecycleStage.BUILD)).toBe(true);
            expect(indexComponent?.lifecycleMethods.has(ComponentLifecycleStage.ABOUT_TO_DISAPPEAR)).toBe(true);
        });

        it('supports signature lookups', () => {
            const entryAbility = collector.collectAllAbilities()
                .find(ability => ability.name === 'EntryAbility');
            const indexComponent = collector.collectAllComponents()
                .find(component => component.name === 'Index');

            expect(entryAbility).toBeDefined();
            expect(indexComponent).toBeDefined();
            expect(collector.getAbilityBySignature(entryAbility!.signature)?.name).toBe('EntryAbility');
            expect(collector.getComponentBySignature(indexComponent!.signature)?.name).toBe('Index');
        });
    });

    it('distinguishes entry and secondary abilities', () => {
        const collector = new AbilityCollector(buildLifecycleScene('multi-ability'));
        const abilities = collector.collectAllAbilities();

        expect(abilities.map(ability => ability.name)).toEqual(
            expect.arrayContaining(['EntryAbility', 'SecondAbility'])
        );
        expect(abilities.find(ability => ability.name === 'EntryAbility')?.isEntry).toBe(true);
        expect(abilities.find(ability => ability.name === 'SecondAbility')?.isEntry).toBe(false);
    });
});
