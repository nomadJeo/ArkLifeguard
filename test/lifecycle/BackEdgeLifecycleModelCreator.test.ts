import { describe, expect, it } from 'vitest';
import 'arkanalyzer';
import { BasicBlock } from '../../src/adapter/arkanalyzer';
import {
    createLifecycleModelCreator,
    DEFAULT_LIFECYCLE_MODEL_MODE,
} from '../../src/lifecycle';
import { buildLifecycleScene } from '../helpers/buildScene';

function hasCycle(blocks: BasicBlock[]): boolean {
    const visited = new Set<BasicBlock>();
    const active = new Set<BasicBlock>();

    const visit = (block: BasicBlock): boolean => {
        if (active.has(block)) return true;
        if (visited.has(block)) return false;
        visited.add(block);
        active.add(block);
        for (const successor of block.getSuccessors()) {
            if (visit(successor)) return true;
        }
        active.delete(block);
        return false;
    };

    return blocks.some(visit);
}

function invokedNames(block: BasicBlock): string[] {
    return block.getStmts().flatMap(stmt => {
        const invoke = stmt.getInvokeExpr();
        return invoke
            ? [invoke.getMethodSignature().getMethodSubSignature().getMethodName()]
            : [];
    });
}

describe('interchangeable lifecycle model entry', () => {
    it('uses the flat model by default and separates start, loop and end callbacks', () => {
        const creator = createLifecycleModelCreator(buildLifecycleScene('simple'));
        creator.create();

        expect(DEFAULT_LIFECYCLE_MODEL_MODE).toBe('flat');
        const blocks = [...creator.getDummyMain().getCfg()!.getBlocks()];
        expect(hasCycle(blocks)).toBe(true);

        const entryNames = invokedNames(blocks[0]);
        expect(entryNames).toEqual(expect.arrayContaining([
            'onCreate',
            'onWindowStageCreate',
            'aboutToAppear',
        ]));
        expect(entryNames).not.toContain('onForeground');

        const returnBlock = blocks.find(block => block.getSuccessors().length === 0)!;
        expect(invokedNames(returnBlock)).toEqual(expect.arrayContaining([
            'aboutToDisappear',
            'onDestroy',
        ]));

        const middleNames = blocks.slice(1).flatMap(invokedNames);
        expect(middleNames).toEqual(expect.arrayContaining([
            'onForeground',
            'onBackground',
            'build',
            'handleClick',
        ]));
    });

    it('keeps back-edge as a compatibility alias for flat', () => {
        const creator = createLifecycleModelCreator(
            buildLifecycleScene('simple'),
            'back-edge'
        );
        creator.create();

        expect(hasCycle([...creator.getDummyMain().getCfg()!.getBlocks()])).toBe(true);
    });

    it('excludes test-source abilities from the flat model', () => {
        const creator = createLifecycleModelCreator(
            buildLifecycleScene('ability-scope-nesting'),
            'flat'
        );
        creator.create();

        expect(creator.getAbilities().map(ability => ability.name)).toEqual(
            expect.arrayContaining(['EntryAbility', 'SecondAbility', 'UnusedAbility'])
        );
        expect(creator.getAbilities().map(ability => ability.name)).not.toContain(
            'TestAbility'
        );
    });

    it('keeps the bounded unroll model selectable for comparison', () => {
        const creator = createLifecycleModelCreator(
            buildLifecycleScene('simple'),
            'bounded-unroll',
            { bounds: { maxCallbackIterations: 1 } as any }
        );
        creator.create();

        const blocks = [...creator.getDummyMain().getCfg()!.getBlocks()];
        expect(hasCycle(blocks)).toBe(false);
    });

    it('keeps the hierarchical model cyclic for unbounded legal repetition', () => {
        const creator = createLifecycleModelCreator(
            buildLifecycleScene('simple'),
            'hierarchical'
        );
        creator.create();

        const blocks = [...creator.getDummyMain().getCfg()!.getBlocks()];
        expect(hasCycle(blocks)).toBe(true);
        expect(blocks.flatMap(invokedNames)).toEqual(expect.arrayContaining([
            'onForeground',
            'onBackground',
            'handleClick',
        ]));
        expect(blocks.every(block => block.getStmts().length > 0)).toBe(true);
    });

    it('provides an optimized flat baseline with the same Ability pruning as M1', () => {
        const creators = ['opt-flat', 'hierarchical'] as const;
        for (const mode of creators) {
            const creator = createLifecycleModelCreator(
                buildLifecycleScene('ability-scope-nesting'),
                mode
            );
            creator.create();
            expect(creator.getAbilities().map(ability => ability.name)).toEqual([
                'EntryAbility',
                'SecondAbility',
            ]);
            expect(creator.getLifecycleModelStatistics().abilities).toEqual({
                collected: 3,
                reachable: 2,
                pruned: 1,
            });
        }
    });

    it('supports independent M1 optimization ablations', () => {
        const create = (optimizations: {
            compactDispatcher?: boolean;
            removeEmptyScopes?: boolean;
            pruneUnreachableAbilities?: boolean;
        }, fixture = 'ability-scope-nesting') => {
            const creator = createLifecycleModelCreator(
                buildLifecycleScene(fixture),
                'hierarchical',
                { optimizations } as any
            );
            creator.create();
            return creator;
        };
        const full = create({});
        const noCompact = create({ compactDispatcher: false });
        expect(noCompact.getDummyMain().getCfg()!.getBlocks().size)
            .toBeGreaterThan(full.getDummyMain().getCfg()!.getBlocks().size);
        expect([...noCompact.getDummyMain().getCfg()!.getBlocks()]
            .flatMap(invokedNames).sort())
            .toEqual([...full.getDummyMain().getCfg()!.getBlocks()]
                .flatMap(invokedNames).sort());

        const emptyFull = create({}, 'edge-cases');
        const noEmpty = create({ removeEmptyScopes: false }, 'edge-cases');
        expect(noEmpty.getDummyMain().getCfg()!.getBlocks().size)
            .toBeGreaterThan(emptyFull.getDummyMain().getCfg()!.getBlocks().size);

        const noPrune = create({ pruneUnreachableAbilities: false });
        expect(noPrune.getAbilities().map(ability => ability.name))
            .toContain('UnusedAbility');
        expect(noPrune.getLifecycleModelStatistics().abilities.pruned).toBe(0);
    });

    it.each(['flat', 'opt-flat', 'hierarchical'] as const)(
        '%s ignores the bounded-unroll callback iteration parameter',
        mode => {
            const shapes = [1, 7].map(maxCallbackIterations => {
                const creator = createLifecycleModelCreator(
                    buildLifecycleScene('simple'),
                    mode,
                    { bounds: { maxCallbackIterations } as any }
                );
                creator.create();
                const blocks = [...creator.getDummyMain().getCfg()!.getBlocks()];
                return {
                    blocks: blocks.length,
                    edges: blocks.reduce(
                        (sum, block) => sum + block.getSuccessors().length,
                        0
                    ),
                    calls: blocks.flatMap(invokedNames).sort(),
                };
            });

            expect(shapes[1]).toEqual(shapes[0]);
        }
    );
});
