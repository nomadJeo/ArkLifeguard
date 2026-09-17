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
    it('uses the back-edge model by default and separates start, loop and end callbacks', () => {
        const creator = createLifecycleModelCreator(buildLifecycleScene('simple'));
        creator.create();

        expect(DEFAULT_LIFECYCLE_MODEL_MODE).toBe('back-edge');
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
});
