import fs from 'node:fs';
import path from 'node:path';

export type ResearchLifecycleModel = 'flat' | 'hierarchical' | 'hierarchical-state';
export type PrecisionLevel = 'M0' | 'M1' | 'M2';

interface BenchmarkCaseBase {
    id: string;
    project: string;
    firstPreciseModel: PrecisionLevel;
    semanticFeasible: boolean;
    expected: Record<ResearchLifecycleModel, boolean>;
}

export interface NullnessBenchmarkCase extends BenchmarkCaseBase {
    observation: 'nullness';
    source: string;
    dereference: string;
}

export interface TransitionBenchmarkCase extends BenchmarkCaseBase {
    observation: 'immediate-transition';
    from: string;
    to: string;
}

export type ControlledLifecycleCase = NullnessBenchmarkCase | TransitionBenchmarkCase;

interface ControlledLifecycleOracle {
    schemaVersion: 1;
    benchmark: 'controlled-lifecycle-modeling';
    cases: ControlledLifecycleCase[];
}

export const CONTROLLED_LIFECYCLE_ROOT = path.join(
    __dirname,
    '../../ArkDefectBench/Lifecycle Modeling'
);

const ORACLE_PATH = path.join(CONTROLLED_LIFECYCLE_ROOT, 'lifecycle_model_expected.json');

function isExpectedModels(value: unknown): value is Record<ResearchLifecycleModel, boolean> {
    const expected = value as Partial<Record<ResearchLifecycleModel, unknown>> | undefined;
    return typeof expected?.flat === 'boolean' &&
        typeof expected.hierarchical === 'boolean' &&
        typeof expected['hierarchical-state'] === 'boolean';
}

function loadOracle(): ControlledLifecycleOracle {
    const oracle = JSON.parse(fs.readFileSync(ORACLE_PATH, 'utf8')) as ControlledLifecycleOracle;
    if (oracle.schemaVersion !== 1 || oracle.benchmark !== 'controlled-lifecycle-modeling' ||
        !Array.isArray(oracle.cases)) {
        throw new Error(`Invalid controlled lifecycle oracle header: ${ORACLE_PATH}`);
    }

    const ids = new Set<string>();
    for (const item of oracle.cases) {
        const validObservation = item.observation === 'nullness'
            ? typeof item.source === 'string' && typeof item.dereference === 'string'
            : item.observation === 'immediate-transition' &&
                typeof item.from === 'string' && typeof item.to === 'string';
        if (!item.id || ids.has(item.id) || !item.project ||
            !['M0', 'M1', 'M2'].includes(item.firstPreciseModel) ||
            typeof item.semanticFeasible !== 'boolean' ||
            !isExpectedModels(item.expected) || !validObservation) {
            throw new Error(`Invalid or duplicate controlled lifecycle case: ${item.id}`);
        }
        ids.add(item.id);
    }
    return oracle;
}

/** M1/M2 expectations are future contracts; only M0 is executable today. */
export const CONTROLLED_LIFECYCLE_CASES: readonly ControlledLifecycleCase[] =
    loadOracle().cases;
