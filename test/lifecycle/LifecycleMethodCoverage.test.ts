import { describe, expect, it } from 'vitest';
import 'arkanalyzer';
import { AbilityCollector } from '../../src/lifecycle/AbilityCollector';
import { LifecycleModelCreator } from '../../src/lifecycle/LifecycleModelCreator';
import {
    AbilityLifecycleStage,
    BackupExtensionLifecycleStage,
    ComponentLifecycleStage,
} from '../../src/lifecycle/LifecycleTypes';
import { buildLifecycleScene } from '../helpers/buildScene';

describe('lifecycle method coverage', () => {
    it('collects all configured lifecycle method families', () => {
        const collector = new AbilityCollector(buildLifecycleScene('lifecycle-coverage'));
        const abilities = collector.collectAllAbilities();
        const components = collector.collectAllComponents();
        const uiAbility = abilities.find(ability => ability.name === 'FullUIAbility');
        const backupAbility = abilities.find(ability => ability.name === 'FullBackupAbility');
        const component = components.find(item => item.name === 'FullComponent');

        expect([...uiAbility!.lifecycleMethods.keys()]).toEqual(
            expect.arrayContaining(Object.values(AbilityLifecycleStage))
        );
        expect([...backupAbility!.lifecycleMethods.keys()]).toEqual(
            expect.arrayContaining(Object.values(BackupExtensionLifecycleStage))
        );
        expect([...component!.lifecycleMethods.keys()]).toEqual(
            expect.arrayContaining(Object.values(ComponentLifecycleStage))
        );
    });

    it('emits all collected lifecycle methods into DummyMain', () => {
        const creator = new LifecycleModelCreator(buildLifecycleScene('lifecycle-coverage'), {
            enableViewTreeParsing: false,
        });
        creator.create();
        const invokedNames = creator.getDummyMain().getCfg()!.getStmts().flatMap(stmt => {
            const invoke = stmt.getInvokeExpr();
            return invoke
                ? [invoke.getMethodSignature().getMethodSubSignature().getMethodName()]
                : [];
        });

        expect(invokedNames).toEqual(expect.arrayContaining([
            ...Object.values(AbilityLifecycleStage),
            ...Object.values(BackupExtensionLifecycleStage),
            ...Object.values(ComponentLifecycleStage),
        ]));
    });
});
