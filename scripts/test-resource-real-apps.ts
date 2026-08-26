#!/usr/bin/env -S npx vite-node

/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    ProjectAnalyzer,
    type MethodLocalResourceLeakRecord,
    type ResourceLeakRecord,
    type TaintLeakRecord,
} from '../src/application/ProjectAnalyzer';

type ProjectStatus = 'success' | 'failed' | 'timeout';

interface ProjectMetadata {
    name: string;
    path: string;
}

interface MetadataFile {
    projects: ProjectMetadata[];
}

interface Options {
    realAppsRoot: string;
    sdkRoot: string;
    projects: string[];
    outputPath?: string;
    timeoutMs: number;
    callbackIterations: number;
    maxAbilitiesPerFlow: number;
    maxNavigationHops: number;
    maxPropagationDepth: number;
    limit?: number;
    listOnly: boolean;
    workerProject?: string;
    workerResult?: string;
}

interface ProjectResult {
    name: string;
    status: ProjectStatus;
    error?: string;
    projectFiles: number;
    classes: number;
    methods: number;
    resourceLeakCount: number;
    taintLeakCount: number;
    methodLocalLeakCount: number;
    sourceCount: number;
    sinkCount: number;
    analyzedMethods: number;
    reachedStatements: number;
    reachedFacts: number;
    totalTimeMs: number;
    resourceAnalysisTimeMs: number;
    peakRssMB: number | null;
    resourceLeaks: ResourceLeakRecord[];
    taintLeaks: TaintLeakRecord[];
    methodLocalLeaks: MethodLocalResourceLeakRecord[];
}

interface RealAppsReport {
    schemaVersion: 1;
    analysisKind: 'resource-leak';
    updatedAt: string;
    completed: boolean;
    settings: {
        sdkRoot: string;
        timeoutMs: number;
        callbackIterations: number;
        maxAbilitiesPerFlow: number;
        maxNavigationHops: number;
        maxPropagationDepth: number;
    };
    summary: {
        selectedProjects: number;
        completedProjects: number;
        successfulProjects: number;
        failedProjects: number;
        timedOutProjects: number;
        projectsWithLeaks: number;
        resourceLeakCount: number;
        taintLeakCount: number;
        methodLocalLeakCount: number;
        averageTotalTimeMs: number;
        averageResourceAnalysisTimeMs: number;
        averagePeakRssMB: number;
        maxPeakRssMB: number;
    };
    projects: ProjectResult[];
}

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repositoryRoot = path.resolve(scriptDir, '..');
const defaultRealAppsRoot = path.join(repositoryRoot, 'HarmonyRealApps');
const viteNodePath = path.join(repositoryRoot, 'node_modules/vite-node/vite-node.mjs');

function help(): void {
    console.log([
        'Usage:',
        '  npm run test:resource:real-apps -- [options]',
        '',
        'Options:',
        '  --project <name>            Analyze one metadata project; repeatable',
        '  --limit <n>                 Analyze only the first n selected projects',
        '  --output <file>             Persist the JSON report; omitted means console only',
        '  --real-apps-root <path>     HarmonyRealApps directory containing meta.json',
        '  --sdk-root <path>           SDK root containing openharmony/ets and hms/ets',
        '  --timeout-ms <n>            Hard per-project timeout; default: 180000',
        '  --callback-iterations <n>   Lifecycle callback expansion rounds; default: 1',
        '  --max-abilities-per-flow <n>  Ability bound for one resource flow; default: 3',
        '  --max-navigation-hops <n>   Navigation bound for one resource flow; default: 5',
        '  --max-propagation-depth <n> Resource fact propagation bound; default: 40',
        '  --list                      List projects without analyzing',
        '  -h, --help                  Show this help',
        '',
        'Examples:',
        '  npm run test:resource:real-apps -- --project AnimeZ',
        '  npm run test:resource:real-apps -- --limit 5 --output out/resource-real-apps.json',
    ].join('\n'));
}

function optionValue(args: string[], index: number, option: string): string {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
    return value;
}

function positiveInteger(value: string, option: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${option} must be a positive integer: ${value}`);
    }
    return parsed;
}

function nonNegativeInteger(value: string, option: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${option} must be a non-negative integer: ${value}`);
    }
    return parsed;
}

function parseArgs(args: string[]): Options {
    let realAppsRoot = defaultRealAppsRoot;
    let sdkRoot: string | undefined;
    const projects: string[] = [];
    let outputPath: string | undefined;
    let timeoutMs = 180_000;
    let callbackIterations = 1;
    let maxAbilitiesPerFlow = 3;
    let maxNavigationHops = 5;
    let maxPropagationDepth = 40;
    let limit: number | undefined;
    let listOnly = false;
    let workerProject: string | undefined;
    let workerResult: string | undefined;

    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        const consume = (option: string): string => {
            const value = optionValue(args, index, option);
            index++;
            return value;
        };
        if (arg === '-h' || arg === '--help') {
            help();
            process.exit(0);
        } else if (arg === '--project') {
            projects.push(consume(arg));
        } else if (arg.startsWith('--project=')) {
            projects.push(arg.slice('--project='.length));
        } else if (arg === '--limit') {
            limit = positiveInteger(consume(arg), arg);
        } else if (arg.startsWith('--limit=')) {
            limit = positiveInteger(arg.slice('--limit='.length), '--limit');
        } else if (arg === '--output') {
            outputPath = path.resolve(consume(arg));
        } else if (arg.startsWith('--output=')) {
            outputPath = path.resolve(arg.slice('--output='.length));
        } else if (arg === '--real-apps-root') {
            realAppsRoot = path.resolve(consume(arg));
        } else if (arg.startsWith('--real-apps-root=')) {
            realAppsRoot = path.resolve(arg.slice('--real-apps-root='.length));
        } else if (arg === '--sdk-root') {
            sdkRoot = path.resolve(consume(arg));
        } else if (arg.startsWith('--sdk-root=')) {
            sdkRoot = path.resolve(arg.slice('--sdk-root='.length));
        } else if (arg === '--timeout-ms') {
            timeoutMs = positiveInteger(consume(arg), arg);
        } else if (arg.startsWith('--timeout-ms=')) {
            timeoutMs = positiveInteger(arg.slice('--timeout-ms='.length), '--timeout-ms');
        } else if (arg === '--callback-iterations') {
            callbackIterations = positiveInteger(consume(arg), arg);
        } else if (arg.startsWith('--callback-iterations=')) {
            callbackIterations = positiveInteger(
                arg.slice('--callback-iterations='.length), '--callback-iterations'
            );
        } else if (arg === '--max-abilities-per-flow') {
            maxAbilitiesPerFlow = nonNegativeInteger(consume(arg), arg);
        } else if (arg.startsWith('--max-abilities-per-flow=')) {
            maxAbilitiesPerFlow = nonNegativeInteger(
                arg.slice('--max-abilities-per-flow='.length), '--max-abilities-per-flow'
            );
        } else if (arg === '--max-navigation-hops') {
            maxNavigationHops = nonNegativeInteger(consume(arg), arg);
        } else if (arg.startsWith('--max-navigation-hops=')) {
            maxNavigationHops = nonNegativeInteger(
                arg.slice('--max-navigation-hops='.length), '--max-navigation-hops'
            );
        } else if (arg === '--max-propagation-depth') {
            maxPropagationDepth = positiveInteger(consume(arg), arg);
        } else if (arg.startsWith('--max-propagation-depth=')) {
            maxPropagationDepth = positiveInteger(
                arg.slice('--max-propagation-depth='.length), '--max-propagation-depth'
            );
        } else if (arg === '--list') {
            listOnly = true;
        } else if (arg === '--worker-project') {
            workerProject = consume(arg);
        } else if (arg === '--worker-result') {
            workerResult = path.resolve(consume(arg));
        } else {
            throw new Error(`Unknown option: ${arg}`);
        }
    }

    realAppsRoot = path.resolve(realAppsRoot);
    return {
        realAppsRoot,
        sdkRoot: sdkRoot ?? path.resolve(realAppsRoot, '../sdk/default'),
        projects,
        outputPath,
        timeoutMs,
        callbackIterations,
        maxAbilitiesPerFlow,
        maxNavigationHops,
        maxPropagationDepth,
        limit,
        listOnly,
        workerProject,
        workerResult,
    };
}

function loadMetadata(realAppsRoot: string): ProjectMetadata[] {
    const metadataPath = path.join(realAppsRoot, 'meta.json');
    if (!fs.existsSync(metadataPath)) {
        throw new Error(`Real-app metadata not found: ${metadataPath}`);
    }
    const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as MetadataFile;
    if (!Array.isArray(parsed.projects)) {
        throw new Error(`Invalid real-app metadata: ${metadataPath}`);
    }
    return parsed.projects;
}

function selectProjects(metadata: ProjectMetadata[], options: Options): ProjectMetadata[] {
    let selected = metadata;
    if (options.projects.length > 0) {
        const byName = new Map(metadata.map(item => [item.name.toLowerCase(), item]));
        selected = options.projects.map(name => {
            const item = byName.get(name.toLowerCase());
            if (!item) throw new Error(`Unknown real-app project: ${name}`);
            return item;
        });
    }
    return options.limit === undefined ? selected : selected.slice(0, options.limit);
}

function emptyProjectResult(metadata: ProjectMetadata): ProjectResult {
    return {
        name: metadata.name,
        status: 'failed',
        projectFiles: 0,
        classes: 0,
        methods: 0,
        resourceLeakCount: 0,
        taintLeakCount: 0,
        methodLocalLeakCount: 0,
        sourceCount: 0,
        sinkCount: 0,
        analyzedMethods: 0,
        reachedStatements: 0,
        reachedFacts: 0,
        totalTimeMs: 0,
        resourceAnalysisTimeMs: 0,
        peakRssMB: null,
        resourceLeaks: [],
        taintLeaks: [],
        methodLocalLeaks: [],
    };
}

async function analyzeProject(metadata: ProjectMetadata, options: Options): Promise<ProjectResult> {
    const record = emptyProjectResult(metadata);
    const projectPath = path.resolve(options.realAppsRoot, metadata.path);
    const start = Date.now();
    try {
        const result = await new ProjectAnalyzer({
            sdkRoot: options.sdkRoot,
            runNullness: false,
            runResourceAnalysis: true,
            analyzeNavigation: false,
            maxCallbackIterations: options.callbackIterations,
            maxAbilitiesPerFlow: options.maxAbilitiesPerFlow,
            maxNavigationHops: options.maxNavigationHops,
            maxPropagationDepth: options.maxPropagationDepth,
        }).analyze(projectPath);
        record.projectFiles = result.summary.projectFiles;
        record.classes = result.summary.classes;
        record.methods = result.summary.methods;
        record.resourceLeaks = result.resourceAnalysis.resourceLeaks;
        record.taintLeaks = result.resourceAnalysis.taintLeaks;
        record.methodLocalLeaks = result.resourceAnalysis.methodLocal.leaks;
        record.resourceLeakCount = record.resourceLeaks.length;
        record.taintLeakCount = record.taintLeaks.length;
        record.methodLocalLeakCount = record.methodLocalLeaks.length;
        record.sourceCount = result.summary.sources;
        record.sinkCount = result.summary.sinks;
        record.analyzedMethods = result.resourceAnalysis.analyzedMethods;
        record.reachedStatements = result.resourceAnalysis.reachedStatements;
        record.reachedFacts = result.resourceAnalysis.reachedFacts;
        record.resourceAnalysisTimeMs = result.duration.resourceAnalysis;
        if (result.status !== 'success' || !result.resourceAnalysis.success) {
            record.error = result.resourceAnalysis.error ??
                (result.errors.join('; ') || 'Resource analysis failed without an error message');
        } else {
            record.status = 'success';
        }
    } catch (error) {
        record.error = error instanceof Error ? error.stack ?? error.message : String(error);
    } finally {
        record.totalTimeMs = Date.now() - start;
        record.peakRssMB = Number((process.resourceUsage().maxRSS / 1024).toFixed(2));
    }
    return record;
}

function writeJsonAtomic(outputPath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const temporary = `${outputPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(temporary, outputPath);
}

function emptySummary(selectedProjects: number): RealAppsReport['summary'] {
    return {
        selectedProjects,
        completedProjects: 0,
        successfulProjects: 0,
        failedProjects: 0,
        timedOutProjects: 0,
        projectsWithLeaks: 0,
        resourceLeakCount: 0,
        taintLeakCount: 0,
        methodLocalLeakCount: 0,
        averageTotalTimeMs: 0,
        averageResourceAnalysisTimeMs: 0,
        averagePeakRssMB: 0,
        maxPeakRssMB: 0,
    };
}

function updateSummary(report: RealAppsReport): void {
    const successful = report.projects.filter(item => item.status === 'success');
    const rss = successful.flatMap(item => item.peakRssMB === null ? [] : [item.peakRssMB]);
    const average = (values: number[]): number => values.length === 0
        ? 0
        : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
    report.updatedAt = new Date().toISOString();
    report.summary = {
        selectedProjects: report.summary.selectedProjects,
        completedProjects: report.projects.length,
        successfulProjects: successful.length,
        failedProjects: report.projects.filter(item => item.status === 'failed').length,
        timedOutProjects: report.projects.filter(item => item.status === 'timeout').length,
        projectsWithLeaks: successful.filter(item =>
            item.resourceLeakCount + item.taintLeakCount + item.methodLocalLeakCount > 0
        ).length,
        resourceLeakCount: successful.reduce((sum, item) => sum + item.resourceLeakCount, 0),
        taintLeakCount: successful.reduce((sum, item) => sum + item.taintLeakCount, 0),
        methodLocalLeakCount: successful.reduce((sum, item) => sum + item.methodLocalLeakCount, 0),
        averageTotalTimeMs: average(successful.map(item => item.totalTimeMs)),
        averageResourceAnalysisTimeMs: average(
            successful.map(item => item.resourceAnalysisTimeMs)
        ),
        averagePeakRssMB: average(rss),
        maxPeakRssMB: rss.length === 0 ? 0 : Math.max(...rss),
    };
}

async function runWorker(options: Options, metadata: ProjectMetadata[]): Promise<void> {
    if (!options.workerProject || !options.workerResult) return;
    const item = metadata.find(candidate => candidate.name === options.workerProject);
    if (!item) throw new Error(`Unknown worker project: ${options.workerProject}`);
    writeJsonAtomic(options.workerResult, await analyzeProject(item, options));
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const metadata = loadMetadata(options.realAppsRoot);
    if (options.workerProject) {
        await runWorker(options, metadata);
        return;
    }
    if (options.listOnly) {
        for (const item of metadata) console.log(`${item.name}\t${item.path}`);
        console.log(`Total: ${metadata.length}`);
        return;
    }
    if (!fs.existsSync(viteNodePath)) {
        throw new Error(`vite-node runner not found: ${viteNodePath}`);
    }

    const selected = selectProjects(metadata, options);
    if (selected.length === 0) throw new Error('No HarmonyRealApps projects selected');
    const report: RealAppsReport = {
        schemaVersion: 1,
        analysisKind: 'resource-leak',
        updatedAt: new Date().toISOString(),
        completed: false,
        settings: {
            sdkRoot: options.sdkRoot,
            timeoutMs: options.timeoutMs,
            callbackIterations: options.callbackIterations,
            maxAbilitiesPerFlow: options.maxAbilitiesPerFlow,
            maxNavigationHops: options.maxNavigationHops,
            maxPropagationDepth: options.maxPropagationDepth,
        },
        summary: emptySummary(selected.length),
        projects: [],
    };
    console.log(
        `Resource real-project evaluation: projects=${selected.length}, ` +
        `sdk=${options.sdkRoot}, timeout=${options.timeoutMs}ms`
    );

    selected.forEach((item, index) => {
        const resultPath = path.join(
            os.tmpdir(), `ark-resource-real-${process.pid}-${Date.now()}-${index}.json`
        );
        console.log(`[${index + 1}/${selected.length}] ${item.name}`);
        const child = spawnSync(process.execPath, [
            viteNodePath,
            scriptPath,
            '--worker-project', item.name,
            '--worker-result', resultPath,
            '--real-apps-root', options.realAppsRoot,
            '--sdk-root', options.sdkRoot,
            '--callback-iterations', String(options.callbackIterations),
            '--max-abilities-per-flow', String(options.maxAbilitiesPerFlow),
            '--max-navigation-hops', String(options.maxNavigationHops),
            '--max-propagation-depth', String(options.maxPropagationDepth),
        ], {
            cwd: repositoryRoot,
            encoding: 'utf8',
            timeout: options.timeoutMs,
            killSignal: 'SIGKILL',
            maxBuffer: 16 * 1024 * 1024,
            env: {
                ...process.env,
                NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=4096`.trim(),
            },
        });

        let record: ProjectResult;
        if (fs.existsSync(resultPath)) {
            record = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as ProjectResult;
        } else {
            record = emptyProjectResult(item);
            if ((child.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') {
                record.status = 'timeout';
                record.error = `Timed out after ${options.timeoutMs}ms`;
                record.totalTimeMs = options.timeoutMs;
            } else {
                record.error = child.error?.message ?? child.stderr?.trim() ??
                    `Worker exited with status ${child.status ?? 'signal'}`;
            }
        }
        fs.rmSync(resultPath, { force: true });
        report.projects.push(record);
        updateSummary(report);
        if (options.outputPath) writeJsonAtomic(options.outputPath, report);
        console.log(
            `  ${record.status.toUpperCase()} leaks=${record.resourceLeakCount} ` +
            `local=${record.methodLocalLeakCount} time=${record.totalTimeMs}ms ` +
            `resource=${record.resourceAnalysisTimeMs}ms`
        );
        if (record.error) console.log(`  error: ${record.error.split(/\r?\n/)[0]}`);
    });

    report.completed = true;
    updateSummary(report);
    if (options.outputPath) {
        writeJsonAtomic(options.outputPath, report);
        console.log(`Report written to: ${options.outputPath}`);
    }
    console.log('Resource real-project summary:');
    console.log(JSON.stringify(report.summary, null, 2));
    if (report.summary.failedProjects > 0 || report.summary.timedOutProjects > 0) {
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
});
