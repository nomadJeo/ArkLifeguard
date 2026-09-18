import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { Scene, SceneConfig } from '../../src/adapter/arkanalyzer';
import { Sdk } from '../../src/adapter/arkanalyzer';
import {
    NullDereferenceDiagnostic,
    NullnessAnalysisRunner,
} from '../../src/analysis/nullness';
import type { LifecycleModelMode } from '../../src/lifecycle';

interface ProgramPoint {
    class: string;
    method: string;
}

interface NullPointerOracleCase {
    id: string;
    category: string[];
    features: string[];
    expected: {
        bug: boolean;
        nullOrigin: ProgramPoint;
        dereference: ProgramPoint;
        executionPath: ProgramPoint[];
    };
}

interface NullPointerOracle {
    schemaVersion: number;
    defectKind: 'null-dereference';
    cases: NullPointerOracleCase[];
}

interface ConfusionCounts {
    tp: number;
    fp: number;
    tn: number;
    fn: number;
}

const METRICS_PREFIX = 'ARK_NPD_METRICS ';

const BENCH_ROOT = path.join(__dirname, '../../ArkDefectBench');
const NULL_POINTER_ROOT = path.join(BENCH_ROOT, 'Null Pointer Dereference');
const ORACLE_PATH = path.join(NULL_POINTER_ROOT, 'null_pointer_expected.json');
const SDK_DIR = path.join(__dirname, '../fixtures/sdk');
const SDK_ROOT = process.env.ARK_SDK_ROOT
    ? path.resolve(process.env.ARK_SDK_ROOT)
    : undefined;
const sdks: Sdk[] = SDK_ROOT ? [
    { name: 'ohosSdk', path: path.join(SDK_ROOT, 'openharmony/ets'), moduleName: '' },
    { name: 'hmsSdk', path: path.join(SDK_ROOT, 'hms/ets'), moduleName: '' },
] : [{ name: '', path: SDK_DIR, moduleName: '' }];
const CALLBACK_ITERATIONS = process.env.ARK_LIFECYCLE_CALLBACK_ITERATIONS
    ? Number(process.env.ARK_LIFECYCLE_CALLBACK_ITERATIONS)
    : undefined;
if (CALLBACK_ITERATIONS !== undefined &&
    (!Number.isInteger(CALLBACK_ITERATIONS) || CALLBACK_ITERATIONS < 1)) {
    throw new Error(`ARK_LIFECYCLE_CALLBACK_ITERATIONS must be a positive integer: ${process.env.ARK_LIFECYCLE_CALLBACK_ITERATIONS}`);
}
const LIFECYCLE_MODEL = (process.env.ARK_LIFECYCLE_MODEL ?? 'flat') as LifecycleModelMode;
if (!['flat', 'hierarchical'].includes(LIFECYCLE_MODEL)) {
    throw new Error(`ARK_LIFECYCLE_MODEL must be flat or hierarchical: ${LIFECYCLE_MODEL}`);
}

function loadOracle(): NullPointerOracle {
    const oracle = JSON.parse(fs.readFileSync(ORACLE_PATH, 'utf8')) as NullPointerOracle;
    if (oracle.schemaVersion !== 2 || oracle.defectKind !== 'null-dereference' ||
        !Array.isArray(oracle.cases)) {
        throw new Error(`Invalid null-pointer oracle header: ${ORACLE_PATH}`);
    }

    const ids = new Set<string>();
    const paths = new Set<string>();
    for (const item of oracle.cases) {
        const idCategory = item.id?.split('.').slice(0, -1);
        if (!item.id || !Array.isArray(item.category) || item.category.length === 0 ||
            JSON.stringify(idCategory) !== JSON.stringify(item.category) ||
            !Array.isArray(item.features) || typeof item.expected?.bug !== 'boolean' ||
            !isProgramPoint(item.expected.nullOrigin) ||
            !isProgramPoint(item.expected.dereference) ||
            !Array.isArray(item.expected.executionPath) ||
            item.expected.executionPath.length === 0 ||
            !item.expected.executionPath.every(isProgramPoint) ||
            ids.has(item.id)) {
            throw new Error(`Invalid or duplicate null-pointer oracle case: ${item.id}`);
        }
        const casePath = getCasePath(item);
        if (paths.has(casePath)) {
            throw new Error(`Duplicate null-pointer oracle path: ${casePath}`);
        }
        ids.add(item.id);
        paths.add(casePath);
    }
    return oracle;
}

function isProgramPoint(value: unknown): value is ProgramPoint {
    const point = value as ProgramPoint | undefined;
    return typeof point?.class === 'string' && point.class.length > 0 &&
        typeof point.method === 'string' && point.method.length > 0;
}

function getCaseName(item: NullPointerOracleCase): string {
    return item.id.split('.').at(-1)!;
}

function getCasePath(item: NullPointerOracleCase): string {
    const folders = item.category.map(part => ({
        Ability: 'AbilityLifecycle',
        Component: 'ComponentLifecycle',
        Page: 'PageLifecycle',
    }[part] ?? part));
    return [...folders, getCaseName(item)].join('/');
}

function buildScene(casePath: string): Scene {
    const projectPath = path.join(NULL_POINTER_ROOT, casePath);
    const config = new SceneConfig();
    config.buildConfig(projectPath, projectPath, sdks);
    config.buildFromProjectDir(projectPath);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

function toComparableDiagnostic(diagnostic: NullDereferenceDiagnostic, casePath: string): {
    nullOrigin: ProgramPoint;
    dereference: ProgramPoint;
} | undefined {
    const caseRoot = path.join(NULL_POINTER_ROOT, casePath);
    const relativeFile = path.relative(caseRoot, diagnostic.dereferenceLocation.filePath);
    if (relativeFile.startsWith('..') || path.isAbsolute(relativeFile)) {
        return undefined;
    }
    return {
        nullOrigin: locateProgramPoint(
            diagnostic.sourceLocation.filePath,
            diagnostic.sourceLocation.line
        ),
        dereference: locateProgramPoint(
            diagnostic.dereferenceLocation.filePath,
            diagnostic.dereferenceLocation.line
        ),
    };
}

function sameProgramPoint(left: ProgramPoint, right: ProgramPoint): boolean {
    return left.class === right.class && left.method === right.method;
}

function sameDiagnostic(
    left: { nullOrigin: ProgramPoint; dereference: ProgramPoint },
    right: { nullOrigin: ProgramPoint; dereference: ProgramPoint }
): boolean {
    return sameProgramPoint(left.nullOrigin, right.nullOrigin) &&
        sameProgramPoint(left.dereference, right.dereference);
}

function calculateConfusionCounts(
    expected: Array<{ nullOrigin: ProgramPoint; dereference: ProgramPoint }>,
    actual: Array<{ nullOrigin: ProgramPoint; dereference: ProgramPoint }>
): ConfusionCounts {
    const unmatchedActual = [...actual];
    let tp = 0;
    for (const expectedDiagnostic of expected) {
        const matchedIndex = unmatchedActual.findIndex(actualDiagnostic =>
            sameDiagnostic(expectedDiagnostic, actualDiagnostic)
        );
        if (matchedIndex >= 0) {
            tp++;
            unmatchedActual.splice(matchedIndex, 1);
        }
    }
    return {
        tp,
        fp: unmatchedActual.length,
        tn: expected.length === 0 && actual.length === 0 ? 1 : 0,
        fn: expected.length - tp,
    };
}

function locateProgramPoint(filePath: string, targetLine: number): ProgramPoint {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    let braceDepth = 0;
    const classScopes: Array<{ name: string; depth: number }> = [];
    const methodScopes: Array<{ name: string; depth: number }> = [];

    for (let lineIndex = 0; lineIndex < Math.min(targetLine - 1, lines.length); lineIndex++) {
        const source = lines[lineIndex];
        const classMatch = source.match(/\b(?:class|struct)\s+([A-Za-z_$][\w$]*)/);
        const functionMatch = source.match(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
        const methodMatch = source.match(
            /^\s*(?:(?:public|private|protected|static|abstract|override|async)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^\{]+)?\{/
        );
        const callbackMatch = source.match(/\.((?:onClick|then|on))\s*\([^;]*=>\s*\{/) ??
            source.match(/\b(setTimeout)\s*\([^;]*=>\s*\{/);
        const openCount = (source.match(/\{/g) ?? []).length;
        const closeCount = (source.match(/\}/g) ?? []).length;
        const scopeDepth = braceDepth + openCount;

        if (classMatch && openCount > 0) {
            classScopes.push({ name: classMatch[1], depth: scopeDepth });
        }
        // ArkUI component DSL blocks such as `Column() { ... }` have the same
        // textual shape as a method declaration. A regular method can only
        // start when we are not already inside another method; callbacks and
        // local `function` declarations remain valid nested scopes.
        const regularMethodName = methodScopes.length === 0 ? methodMatch?.[1] : undefined;
        const methodName = callbackMatch?.[1] ?? functionMatch?.[1] ?? regularMethodName;
        if (methodName && !['if', 'for', 'while', 'switch', 'catch'].includes(methodName) &&
            openCount > 0) {
            methodScopes.push({ name: methodName, depth: scopeDepth });
        }

        braceDepth += openCount - closeCount;
        while (methodScopes.length > 0 && methodScopes.at(-1)!.depth > braceDepth) {
            methodScopes.pop();
        }
        while (classScopes.length > 0 && classScopes.at(-1)!.depth > braceDepth) {
            classScopes.pop();
        }
    }

    return {
        class: classScopes.at(-1)?.name ?? '<global>',
        method: methodScopes.at(-1)?.name ?? '<field-initializer>',
    };
}

function discoverBenchmarkCases(): string[] {
    const casePaths = new Set<string>();

    function walk(directory: string): void {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                walk(entryPath);
                continue;
            }
            if (!entry.isFile() || !/\.(ets|ts)$/.test(entry.name)) {
                continue;
            }

            const sourceDirectory = path.dirname(entryPath);
            const caseRoot = path.dirname(sourceDirectory);
            casePaths.add(path.relative(NULL_POINTER_ROOT, caseRoot).split(path.sep).join('/'));
        }
    }

    walk(NULL_POINTER_ROOT);
    return [...casePaths].sort();
}

const oracle = loadOracle();
const selectedCase = process.env.ARK_NPD_CASE;
const selectedOracle = selectedCase === undefined
    ? oracle.cases
    : oracle.cases.filter(item => item.id === selectedCase || getCaseName(item) === selectedCase);

if (selectedCase !== undefined && selectedOracle.length === 0) {
    throw new Error(`Unknown ArkDefectBench null-pointer case: ${selectedCase}`);
}

describe.sequential('ArkDefectBench null-pointer conformance', () => {
    it('loads every null-pointer benchmark case from the oracle', () => {
        expect(oracle.cases.map(getCasePath).sort()).toEqual(discoverBenchmarkCases());
    });

    it.each(selectedOracle)(
        '$id [$category]',
        oracleItem => {
            const casePath = getCasePath(oracleItem);
            const scene = buildScene(casePath);
            const result = new NullnessAnalysisRunner(scene, {
                lifecycleModel: LIFECYCLE_MODEL,
                ...(CALLBACK_ITERATIONS === undefined ? {} : {
                    lifecycle: { bounds: { maxCallbackIterations: CALLBACK_ITERATIONS } },
                }),
            }).runFromDummyMain();

            expect(result.success, result.error).toBe(true);
            const actualDiagnostics = result.diagnostics
                .map(diagnostic => toComparableDiagnostic(diagnostic, casePath))
                .filter((diagnostic): diagnostic is NonNullable<typeof diagnostic> =>
                    diagnostic !== undefined
                );
            const expectedDiagnostics = oracleItem.expected.bug ? [{
                nullOrigin: oracleItem.expected.nullOrigin,
                dereference: oracleItem.expected.dereference,
            }] : [];

            const counts = calculateConfusionCounts(expectedDiagnostics, actualDiagnostics);
            const metrics = { id: oracleItem.id, lifecycleModel: LIFECYCLE_MODEL, ...counts };
            if (process.env.ARK_NPD_METRICS_FILE) {
                fs.appendFileSync(
                    process.env.ARK_NPD_METRICS_FILE,
                    `${JSON.stringify(metrics)}\n`,
                    'utf8'
                );
            } else {
                console.log(`${METRICS_PREFIX}${JSON.stringify(metrics)}`);
            }

            expect(actualDiagnostics).toEqual(expectedDiagnostics);
        }
    );
});
