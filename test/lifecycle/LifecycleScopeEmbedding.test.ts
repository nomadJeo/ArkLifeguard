import { describe, expect, it } from 'vitest';
import 'arkanalyzer';
import { AbilityCollector } from '../../src/lifecycle/AbilityCollector';
import { LifecycleModelCreator } from '../../src/lifecycle/LifecycleModelCreator';
import { buildLifecycleScene } from '../helpers/buildScene';

function statements(creator: LifecycleModelCreator): string[] {
    return [...creator.getDummyMain().getCfg()!.getBlocks()]
        .flatMap(block => block.getStmts().map(stmt => stmt.toString()));
}

describe('lifecycle scope embedding', () => {
    it('links loaded components to their owning abilities', () => {
        const abilities = new AbilityCollector(buildLifecycleScene('ability-scope-nesting'))
            .collectAllAbilities();

        expect(abilities.find(ability => ability.name === 'EntryAbility')
            ?.components.map(component => component.name)).toContain('EntryPage');
        expect(abilities.find(ability => ability.name === 'SecondAbility')
            ?.components.map(component => component.name)).toContain('SecondPage');
    });

    it('embeds a loaded component before the next ability branch', () => {
        const creator = new LifecycleModelCreator(buildLifecycleScene('ability-scope-nesting'));
        creator.create();
        const stmts = statements(creator);
        const entryAbility = stmts.findIndex(stmt => stmt.includes('EntryAbility.onCreate'));
        const entryPage = stmts.findIndex(stmt => stmt.includes('EntryPage.aboutToAppear'));
        const secondAbility = stmts.findIndex(stmt => stmt.includes('SecondAbility.onCreate'));
        const secondPage = stmts.findIndex(stmt => stmt.includes('SecondPage.aboutToAppear'));

        expect(entryAbility).toBeGreaterThanOrEqual(0);
        expect(entryPage).toBeGreaterThan(entryAbility);
        expect(secondAbility).toBeGreaterThan(entryPage);
        expect(secondPage).toBeGreaterThan(secondAbility);
    });
});
