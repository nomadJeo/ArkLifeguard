import { describe, expect, it, vi } from 'vitest';
import { haveSameCallableIdentity, tryRenderArkType } from '../../src/analysis/nullness/ArkAnalyzerCompatibility';

function signature(options: {
    project?: string;
    file?: string;
    className?: string;
    method?: string;
    parameterCount?: number;
    isStatic?: boolean;
} = {}): any {
    const namespace = {
        getNamespaceName: () => 'Fixtures',
        getDeclaringNamespaceSignature: () => null,
    };
    const file = {
        getProjectName: () => options.project ?? 'project',
        getFileName: () => options.file ?? 'Index.ets',
    };
    const declaringClass = {
        getClassName: () => options.className ?? 'Index',
        getDeclaringFileSignature: () => file,
        getDeclaringNamespaceSignature: () => namespace,
    };
    const subSignature = {
        getMethodName: () => options.method ?? 'callback',
        isStatic: () => options.isStatic ?? false,
        getParameters: () => Array.from({ length: options.parameterCount ?? 1 }),
    };
    return {
        getDeclaringClassSignature: () => declaringClass,
        getMethodSubSignature: () => subSignature,
        toString: vi.fn(() => {
            throw new RangeError('recursive generic type');
        }),
    };
}

describe('ArkAnalyzer nullness compatibility', () => {
    it('compares callback identities without rendering recursive parameter types', () => {
        const left = signature();
        const right = signature();

        expect(haveSameCallableIdentity(left, right)).toBe(true);
        expect(left.toString).not.toHaveBeenCalled();
        expect(right.toString).not.toHaveBeenCalled();
    });

    it('does not merge different overload arities', () => {
        expect(haveSameCallableIdentity(
            signature({ parameterCount: 1 }),
            signature({ parameterCount: 2 })
        )).toBe(false);
    });

    it('treats recursive type rendering as unavailable', () => {
        expect(tryRenderArkType({
            toString: () => {
                throw new RangeError('recursive generic type');
            },
        })).toBeNull();
    });
});
