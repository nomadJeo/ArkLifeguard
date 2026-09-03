export function run(): number {
    let result = 0;
    try {
        result = 1;
        throw new Error('explicit failure');
    } catch (error) {
        result = 2;
    }
    return result;
}

function fail(): never {
    throw new Error('callee failure');
}

function middle(): never {
    fail();
    throw new Error('unreachable fallback');
}

export function callAndCatch(): number {
    let result = 0;
    try {
        fail();
    } catch (error) {
        result = 1;
    }
    return result;
}

export function callThroughMiddleAndCatch(): number {
    let result = 0;
    try {
        middle();
    } catch (error) {
        result = 1;
    }
    return result;
}

export function noThrowCatch(): number {
    let result = 0;
    try {
        result = 1;
    } catch (error) {
        result = 2;
    }
    return result;
}

export function uncaughtThrow(): number {
    throw new Error('uncaught failure');
    return 1;
}
