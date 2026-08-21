import { describe, expect, it } from 'vitest';
import 'arkanalyzer';
import { LifecycleModelCreator } from '../../src/lifecycle/LifecycleModelCreator';
import { buildLifecycleScene } from '../helpers/buildScene';

function invokedMethodNames(creator: LifecycleModelCreator): string[] {
    const cfg = creator.getDummyMain().getCfg();
    expect(cfg).toBeDefined();
    return [...cfg!.getBlocks()].flatMap(block =>
        block.getStmts().flatMap(stmt => {
            const invoke = stmt.getInvokeExpr();
            return invoke
                ? [invoke.getMethodSignature().getMethodSubSignature().getMethodName()]
                : [];
        })
    );
}

describe('LifecycleModelCreator', () => {
    it('builds a connected DummyMain CFG for a simple project', () => {
        const creator = new LifecycleModelCreator(buildLifecycleScene('simple'));
        creator.create();

        const cfg = creator.getDummyMain().getCfg();
        expect(cfg).toBeDefined();
        expect(cfg!.getBlocks().size).toBeGreaterThan(0);
        expect(cfg!.getStartingStmt()).toBeDefined();

        for (const block of cfg!.getBlocks()) {
            for (const stmt of block.getStmts()) {
                expect(stmt.getCfg()).toBe(cfg);
            }
        }
    });

    it('emits ability, component and UI callback invocations', () => {
        const creator = new LifecycleModelCreator(buildLifecycleScene('simple'));
        creator.create();
        const names = invokedMethodNames(creator);

        expect(names).toEqual(expect.arrayContaining([
            'onCreate',
            'onWindowStageCreate',
            'onForeground',
            'build',
            'aboutToAppear',
            'handleClick',
        ]));
    });

    it('models all abilities from a multi-ability project', () => {
        const creator = new LifecycleModelCreator(buildLifecycleScene('multi-ability'));
        creator.create();

        expect(creator.getAbilities().map(ability => ability.name)).toEqual(
            expect.arrayContaining(['EntryAbility', 'SecondAbility'])
        );
    });
});
