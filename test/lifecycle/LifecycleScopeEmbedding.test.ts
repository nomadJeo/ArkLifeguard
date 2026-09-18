import { describe, expect, it } from 'vitest';
import 'arkanalyzer';
import { AbilityCollector } from '../../src/lifecycle/AbilityCollector';
import { LifecycleModelCreator } from '../../src/lifecycle/LifecycleModelCreator';
import { HierarchicalLifecycleModelCreator } from '../../src/lifecycle/HierarchicalLifecycleModelCreator';
import type { BasicBlock } from '../../src/adapter/arkanalyzer';
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

    it('keeps each UI callback inside its owning Ability scope in M1', () => {
        const creator = new HierarchicalLifecycleModelCreator(
            buildLifecycleScene('ability-scope-nesting')
        );
        creator.create();
        expect(creator.getAbilities().map(ability => ability.name)).toEqual([
            'EntryAbility',
            'SecondAbility',
        ]);
        const blocks = [...creator.getDummyMain().getCfg()!.getBlocks()];
        const findBlock = (text: string): BasicBlock => {
            const block = blocks.find(candidate => candidate.getStmts()
                .some(stmt => stmt.toString().includes(text)));
            expect(block, `missing block containing ${text}`).toBeDefined();
            return block!;
        };
        const canReachWithout = (
            start: BasicBlock,
            target: BasicBlock,
            forbidden: BasicBlock
        ): boolean => {
            const pending = [start];
            const visited = new Set<BasicBlock>();
            while (pending.length > 0) {
                const current = pending.pop()!;
                if (current === target) return true;
                if (current === forbidden || visited.has(current)) continue;
                visited.add(current);
                pending.push(...current.getSuccessors());
            }
            return false;
        };

        const entryForeground = findBlock('EntryAbility.onForeground');
        const secondForeground = findBlock('SecondAbility.onForeground');
        const entryTap = findBlock('EntryPage.handleEntryTap');
        const secondTap = findBlock('SecondPage.handleSecondTap');

        expect(canReachWithout(entryForeground, entryTap, secondForeground)).toBe(true);
        expect(canReachWithout(entryForeground, secondTap, secondForeground)).toBe(false);
        expect(canReachWithout(secondForeground, secondTap, entryForeground)).toBe(true);
        expect(canReachWithout(secondForeground, entryTap, entryForeground)).toBe(false);
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
