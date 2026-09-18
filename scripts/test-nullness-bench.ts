#!/usr/bin/env -S npx vite-node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

interface OracleCase {
    id: string;
}

interface BenchmarkCase {
    id: string;
    name: string;
}

interface ConfusionMetrics {
    id: string;
    tp: number;
    fp: number;
    tn: number;
    fn: number;
}

interface BenchmarkResult {
    caseName: string;
    status: string;
    metrics?: ConfusionMetrics;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const benchRoot = path.join(repoRoot, 'ArkDefectBench');
const oraclePath = path.join(
    benchRoot,
    'Null Pointer Dereference',
    'null_pointer_expected.json'
);
const testPath = path.resolve(
    scriptDir,
    '../test/nullness/NullnessArkDefectBench.test.ts'
);
const vitestPath = path.join(
    repoRoot,
    'node_modules/vitest/vitest.mjs'
);

function loadCases(): BenchmarkCase[] {
    const oracle = JSON.parse(fs.readFileSync(oraclePath, 'utf8')) as {
        schemaVersion?: number;
        cases?: OracleCase[];
    };
    if (oracle.schemaVersion !== 2 || !Array.isArray(oracle.cases)) {
        throw new Error(`Invalid null-pointer oracle: ${oraclePath}`);
    }
    return oracle.cases.map(item => ({
        id: item.id,
        name: item.id.split('.').at(-1) ?? item.id,
    }));
}

function parseArgs(args: string[]): {
    selectedCase?: string;
    lifecycleModel: 'flat' | 'hierarchical';
} {
    let selectedCase: string | undefined;
    let lifecycleModel: 'flat' | 'hierarchical' = 'flat';
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--help' || arg === '-h') {
            console.log('Usage: npm run test:nullness:bench -- [--case <case-name>] [--model <flat|hierarchical>]');
            process.exit(0);
        }
        if (arg === '--case') {
            selectedCase = args[++index];
            if (!selectedCase) {
                throw new Error('--case requires a case name');
            }
            continue;
        }
        if (arg.startsWith('--case=')) {
            selectedCase = arg.slice('--case='.length);
            continue;
        }
        if (arg === '--model') {
            const value = args[++index];
            if (value !== 'flat' && value !== 'hierarchical') {
                throw new Error('--model requires flat or hierarchical');
            }
            lifecycleModel = value;
            continue;
        }
        if (arg.startsWith('--model=')) {
            const value = arg.slice('--model='.length);
            if (value !== 'flat' && value !== 'hierarchical') {
                throw new Error('--model requires flat or hierarchical');
            }
            lifecycleModel = value;
            continue;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    return { selectedCase, lifecycleModel };
}

function runBatch(
    selectedCases: readonly BenchmarkCase[],
    lifecycleModel: 'flat' | 'hierarchical'
): BenchmarkResult[] {
    const label = selectedCases.length === 1 ? selectedCases[0].id : `${selectedCases.length} cases`;
    console.log(`\n===== ArkDefectBench: ${label}; model=${lifecycleModel} =====`);
    const metricsPath = path.join(
        os.tmpdir(),
        `ark-npd-metrics-${process.pid}-${Date.now()}.jsonl`
    );
    const result = spawnSync(
        process.execPath,
        [
            vitestPath,
            'run',
            testPath,
            `--reporter=${selectedCases.length === 1 ? 'verbose' : 'dot'}`,
            '--pool=forks',
            '--no-cache',
            '--testTimeout=60000',
            ...(selectedCases.length === 1 ? [] : ['--silent']),
        ],
        {
            cwd: repoRoot,
            env: {
                ...process.env,
                ARK_NPD_CASE: selectedCases.length === 1
                    ? selectedCases[0].id
                    : undefined,
                ARK_NPD_METRICS_FILE: metricsPath,
                ARK_LIFECYCLE_MODEL: lifecycleModel,
                NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=1024`.trim(),
            },
            stdio: 'inherit',
            timeout: Math.max(60_000, selectedCases.length * 60_000),
        }
    );

    const metricsById = new Map<string, ConfusionMetrics>();
    if (fs.existsSync(metricsPath)) {
        try {
            for (const line of fs.readFileSync(metricsPath, 'utf8').split(/\r?\n/)) {
                if (!line.trim()) continue;
                const metrics = JSON.parse(line) as ConfusionMetrics;
                metricsById.set(metrics.id, metrics);
            }
        } catch {
            metricsById.clear();
        }
        fs.rmSync(metricsPath, { force: true });
    }

    return selectedCases.map(item => {
        const metrics = metricsById.get(item.id);
        let status;
        if (metrics) {
            status = metrics.fp === 0 && metrics.fn === 0 ? 'PASS' : 'FAIL';
        } else if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') {
            status = 'TIMEOUT';
        } else if (result.error) {
            status = `ERROR: ${result.error.message}`;
        } else {
            status = `ERROR: no metrics (${result.status ?? 'signal'})`;
        }
        return { caseName: item.id, status, metrics };
    });
}

function formatClassification(metrics: ConfusionMetrics | undefined): string {
    if (!metrics) {
        return 'UNCLASSIFIED';
    }
    const labels: string[] = [];
    if (metrics.tp > 0) labels.push(`TP:${metrics.tp}`);
    if (metrics.fp > 0) labels.push(`FP:${metrics.fp}`);
    if (metrics.tn > 0) labels.push(`TN:${metrics.tn}`);
    if (metrics.fn > 0) labels.push(`FN:${metrics.fn}`);
    return labels.join('+') || 'UNCLASSIFIED';
}

function formatRate(numerator: number, denominator: number): string {
    if (denominator === 0) {
        return 'N/A';
    }
    return `${(numerator / denominator * 100).toFixed(2)}%`;
}

const { selectedCase, lifecycleModel } = parseArgs(process.argv.slice(2));
const cases = loadCases();
const selected = selectedCase === undefined
    ? cases
    : cases.filter(item => item.id === selectedCase || item.name === selectedCase);
if (selectedCase !== undefined && selected.length === 0) {
    throw new Error(
        `Unknown ArkDefectBench case: ${selectedCase}. Available cases: ${cases.map(item => item.name).join(', ')}`
    );
}
const results = runBatch(selected, lifecycleModel);
const failed = results.filter(result => result.status !== 'PASS');

console.log(`\n===== ArkDefectBench null-pointer summary; model=${lifecycleModel} =====`);
for (const result of results) {
    console.log(
        `${result.status.padEnd(13)} ${formatClassification(result.metrics).padEnd(14)} ${result.caseName}`
    );
}
console.log(`Total: ${results.length}, passed: ${results.length - failed.length}, failed: ${failed.length}`);

const classifiedResults = results.filter(
    (result): result is BenchmarkResult & { metrics: ConfusionMetrics } =>
        result.metrics !== undefined
);
const totals = classifiedResults.reduce((sum, result) => ({
    tp: sum.tp + result.metrics.tp,
    fp: sum.fp + result.metrics.fp,
    tn: sum.tn + result.metrics.tn,
    fn: sum.fn + result.metrics.fn,
}), { tp: 0, fp: 0, tn: 0, fn: 0 });
console.log(
    `Confusion matrix: TP=${totals.tp}, FP=${totals.fp}, TN=${totals.tn}, FN=${totals.fn}`
);
console.log(`Recall: ${formatRate(totals.tp, totals.tp + totals.fn)}`);
console.log(
    `Accuracy: ${formatRate(
        totals.tp + totals.tn,
        totals.tp + totals.fp + totals.tn + totals.fn
    )}`
);
if (classifiedResults.length !== results.length) {
    console.log(`Unclassified: ${results.length - classifiedResults.length}`);
}

process.exitCode = failed.length === 0 ? 0 : 1;
