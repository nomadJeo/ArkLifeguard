// @ts-expect-error Resolved by ArkAnalyzer's test SDK, not TypeScript module lookup.
import { CallbackSdk } from '@ohos.callbacks';

export function unused(): number { return 1; }
export function used(): number { return 2; }

export function ignore(callback: () => number): number { return 0; }
export function invokeSecond(first: () => number, second: () => number): number {
    const alias = second;
    return alias();
}
export function forward(first: () => number, second: () => number): number {
    return invokeSecond(first, second);
}
export function recursiveA(callback: () => number, stop: boolean): number {
    if (stop) return callback();
    return recursiveB(callback, stop);
}
export function recursiveB(callback: () => number, stop: boolean): number {
    return recursiveA(callback, stop);
}
export function recursiveIgnore(callback: () => number): number {
    return recursiveIgnore(callback);
}
export function forwardToSdk(first: () => number, second: () => number): number {
    return CallbackSdk.externalPair(first, second);
}
export class Base {
    dispatch(callback: () => number): number { return 0; }
}
export class Derived extends Base {
    dispatch(callback: () => number): number { return callback(); }
}

export function runIgnored(): number { return ignore(unused); }
export function runUsed(): number { return invokeSecond(unused, used); }
export function runForward(): number { return forward(unused, used); }
export function runRecursive(): number { return recursiveB(used, true); }
export function runRecursiveIgnore(): number { return recursiveIgnore(unused); }
export function runSdk(): number { return CallbackSdk.externalPair(unused, used); }
export function runSdkStatement(): void { CallbackSdk.externalPair(unused, used); }
export function runForwardToSdk(): number { return forwardToSdk(unused, used); }
export function runVirtual(target: Base): number { return target.dispatch(used); }
export function runPointer(): number {
    const target = invokeSecond;
    return target(unused, used);
}
export function runPointerAlias(): number {
    const target = used;
    const alias = target;
    return alias();
}

export function sameTarget(callback: unknown): number { return 0; }
export function runSameTarget(): number { return sameTarget(sameTarget); }

type Callback = () => number;
export function runReassignedPointer(flag: boolean): number {
    let target: Callback = unused;
    if (flag) target = used;
    return target();
}

export class Callbacks {
    static first(): number { return 1; }
    static second(): number { return 2; }
}
export function runCrossClassSdk(): number {
    return CallbackSdk.externalPair(Callbacks.first, Callbacks.second);
}
