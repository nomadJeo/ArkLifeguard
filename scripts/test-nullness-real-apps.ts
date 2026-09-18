#!/usr/bin/env -S npx vite-node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Sdk } from '../src/adapter/arkanalyzer';
import { Scene, SceneConfig } from '../src/adapter/arkanalyzer';
import type { LifecycleModelMode } from '../src/lifecycle';
import type { IFDSSolverStatistics } from '../src/ifds';
import {
    NullnessAnalysisRunner,
    type NullnessSolverBreakdown,
    type NullnessLifecycleModelStatistics,
} from '../src/analysis/nullness/NullnessAnalysisRunner';

type ProjectStatus = 'success' | 'failed' | 'timeout';

interface ProjectMetadata {
    name: string;
    path: string;
    repo: string;
    revision: string;
    resolvedCommit: string;
    compileSdkVersion: string | number | null;
    compatibleSdkVersion: string | number | null;
    targetSdkVersion: string | number | null;
}

interface Options {
    realAppsRoot: string;
    sdkRoot: string;
    projects: string[];
    outputPath?: string;
    timeoutMs: number;
    lifecycleModel: Extract<LifecycleModelMode, 'flat' | 'hierarchical'>;
    collectSolverStatistics: boolean;
    lifecycleRootOnly: boolean;
    maxAccessPathLength: number;
    maxPropagationDepth: number;
    limit?: number;
    listOnly: boolean;
    workerProject?: string;
    workerResult?: string;
}

interface LocationRecord {
    file: string;
    line: number;
    col: number;
}

interface DiagnosticRecord {
    nullness: string;
    accessPath: string;
    description: string;
    confidence: 'high' | 'low';
    source: LocationRecord;
    dereference: LocationRecord;
}

interface ProjectResult {
    name: string;
    status: ProjectStatus;
    error?: string;
    projectFiles: number;
    classes: number;
    methods: number;
    diagnosticCount: number;
    reachedStatements: number;
    reachedFacts: number;
    totalTimeMs: number;
    analysisTimeMs: number;
    solverStatistics?: Readonly<IFDSSolverStatistics>;
    solverBreakdown?: NullnessSolverBreakdown;
    lifecycleModelStatistics?: NullnessLifecycleModelStatistics;
    peakRssMB: number | null;
    diagnostics: DiagnosticRecord[];
}

interface RealAppsReport {
    schemaVersion: 3;
    analysisKind: 'null-dereference';
    updatedAt: string;
    completed: boolean;
    settings: {
        sdkRoot: string;
        timeoutMs: number;
        lifecycleModel: Extract<LifecycleModelMode, 'flat' | 'hierarchical'>;
        collectSolverStatistics: boolean;
        lifecycleRootOnly: boolean;
        maxAccessPathLength: number;
        maxPropagationDepth: number;
    };
    summary: {
        selectedProjects: number;
        completedProjects: number;
        successfulProjects: number;
        failedProjects: number;
        timedOutProjects: number;
        projectsWithDiagnostics: number;
        diagnosticCount: number;
        averageTotalTimeMs: number;
        averageNullnessAnalysisTimeMs: number;
        totalIFDSSolveTimeMs: number;
        averageIFDSSolveTimeMs: number;
        totalLifecycleIFDSSolveTimeMs: number;
        totalSupplementalIFDSSolveTimeMs: number;
        supplementalRootCount: number;
        averagePeakRssMB: number;
        maxPeakRssMB: number;
    };
    projects: ProjectResult[];
}

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repositoryRoot = path.resolve(scriptDir, '..');
const defaultRealAppsRoot = path.join(repositoryRoot, 'HarmonyRealApps');
const viteNodePath = path.join(
    repositoryRoot,
    'node_modules/vite-node/vite-node.mjs'
);

function help(): void {
    console.log([
        'Usage:',
        '  npm run test:nullness:real-apps -- [options]',
        '',
        'Options:',
        '  --project <name>          Analyze one metadata project; repeatable',
        '  --limit <n>               Analyze only the first n selected projects',
        '  --output <file>           Persist the JSON report; omitted means console only',
        '  --real-apps-root <path>   HarmonyRealApps directory containing meta.json',
        '  --sdk-root <path>         SDK root containing openharmony/ets and hms/ets',
        '  --timeout-ms <n>          Per-project timeout; default: 600000',
        '  --lifecycle-model <mode>  flat or hierarchical; default: flat',
        '  --ifds-stats              Collect IFDS solver time and counters',
        '  --lifecycle-root-only     Disable module-initializer/framework-sink roots',
        '  --max-access-path-length <n> Maximum tracked field depth; default: 5',
        '  --max-propagation-depth <n> Maximum fact propagation depth; default: 40',
        '  --list                    List projects from meta.json without analyzing',
        '  -h, --help                Show this help',
        '',
        `Default HarmonyRealApps root: ${defaultRealAppsRoot}`,
        'Default SDK root: <HarmonyRealApps root>/../sdk/default',
        '',
        'Examples:',
        '  npm run test:nullness:real-apps -- --project OxHornCampus',
        '  npm run test:nullness:real-apps -- --limit 5 --output results/nullness-real-apps.json',
        '  npm run test:nullness:real-apps -- --output results/nullness-real-apps.json',
    ].join('\n'));
}

function optionValue(args: string[], index: number, option: string): string {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`${option} requires a value`);
    }
    return value;
}

function parsePositiveInteger(value: string, option: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${option} must be a positive integer: ${value}`);
    }
    return parsed;
}

function parseArgs(args: string[]): Options {
    let realAppsRoot = defaultRealAppsRoot;
    let sdkRoot: string | undefined;
    const projects: string[] = [];
    let outputPath: string | undefined;
    let timeoutMs = 600_000;
    let lifecycleModel: Extract<LifecycleModelMode, 'flat' | 'hierarchical'> = 'flat';
    let collectSolverStatistics = false;
    let lifecycleRootOnly = false;
    let maxAccessPathLength = 5;
    // Real projects can contain recursive framework/task call chains. A bound of
    // 40 retained the same AnimeZ diagnostics as 60 while avoiding context blow-up.
    let maxPropagationDepth = 40;
    let limit: number | undefined;
    let listOnly = false;
    let workerProject: string | undefined;
    let workerResult: string | undefined;

    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '-h' || arg === '--help') {
            help();
            process.exit(0);
        }
        if (arg === '--project') {
            projects.push(optionValue(args, index, arg));
            index++;
            continue;
        }
        if (arg.startsWith('--project=')) {
            projects.push(arg.slice('--project='.length));
            continue;
        }
        if (arg === '--limit') {
            limit = parsePositiveInteger(optionValue(args, index, arg), arg);
            index++;
            continue;
        }
        if (arg.startsWith('--limit=')) {
            limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
            continue;
        }
        if (arg === '--output') {
            outputPath = path.resolve(optionValue(args, index, arg));
            index++;
            continue;
        }
        if (arg.startsWith('--output=')) {
            outputPath = path.resolve(arg.slice('--output='.length));
            continue;
        }
        if (arg === '--real-apps-root') {
            realAppsRoot = path.resolve(optionValue(args, index, arg));
            index++;
            continue;
        }
        if (arg.startsWith('--real-apps-root=')) {
            realAppsRoot = path.resolve(arg.slice('--real-apps-root='.length));
            continue;
        }
        if (arg === '--sdk-root') {
            sdkRoot = path.resolve(optionValue(args, index, arg));
            index++;
            continue;
        }
        if (arg.startsWith('--sdk-root=')) {
            sdkRoot = path.resolve(arg.slice('--sdk-root='.length));
            continue;
        }
        if (arg === '--timeout-ms') {
            timeoutMs = parsePositiveInteger(optionValue(args, index, arg), arg);
            index++;
            continue;
        }
        if (arg.startsWith('--timeout-ms=')) {
            timeoutMs = parsePositiveInteger(arg.slice('--timeout-ms='.length), '--timeout-ms');
            continue;
        }
        if (arg === '--lifecycle-model') {
            const value = optionValue(args, index, arg);
            if (value !== 'flat' && value !== 'hierarchical') {
                throw new Error(`${arg} must be flat or hierarchical: ${value}`);
            }
            lifecycleModel = value;
            index++;
            continue;
        }
        if (arg.startsWith('--lifecycle-model=')) {
            const value = arg.slice('--lifecycle-model='.length);
            if (value !== 'flat' && value !== 'hierarchical') {
                throw new Error(`--lifecycle-model must be flat or hierarchical: ${value}`);
            }
            lifecycleModel = value;
            continue;
        }
        if (arg === '--ifds-stats') {
            collectSolverStatistics = true;
            continue;
        }
        if (arg === '--lifecycle-root-only') {
            lifecycleRootOnly = true;
            continue;
        }
        if (arg === '--max-access-path-length') {
            maxAccessPathLength = parsePositiveInteger(optionValue(args, index, arg), arg);
            index++;
            continue;
        }
        if (arg.startsWith('--max-access-path-length=')) {
            maxAccessPathLength = parsePositiveInteger(
                arg.slice('--max-access-path-length='.length),
                '--max-access-path-length'
            );
            continue;
        }
        if (arg === '--max-propagation-depth') {
            maxPropagationDepth = parsePositiveInteger(optionValue(args, index, arg), arg);
            index++;
            continue;
        }
        if (arg.startsWith('--max-propagation-depth=')) {
            maxPropagationDepth = parsePositiveInteger(
                arg.slice('--max-propagation-depth='.length),
                '--max-propagation-depth'
            );
            continue;
        }
        if (arg === '--list') {
            listOnly = true;
            continue;
        }
        if (arg === '--worker-project') {
            workerProject = optionValue(args, index, arg);
            index++;
            continue;
        }
        if (arg === '--worker-result') {
            workerResult = path.resolve(optionValue(args, index, arg));
            index++;
            continue;
        }
        throw new Error(`Unknown option: ${arg}`);
    }

    realAppsRoot = path.resolve(realAppsRoot);
    const resolvedSdkRoot = sdkRoot ?? path.resolve(realAppsRoot, '../sdk/default');
    return {
        realAppsRoot,
        sdkRoot: resolvedSdkRoot,
        projects,
        outputPath,
        timeoutMs,
        lifecycleModel,
        collectSolverStatistics,
        lifecycleRootOnly,
        maxAccessPathLength,
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
        throw new Error(`HarmonyRealApps metadata not found: ${metadataPath}`);
    }
    const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as {
        projects?: ProjectMetadata[];
    };
    if (!Array.isArray(parsed.projects)) {
        throw new Error(`Invalid HarmonyRealApps metadata: ${metadataPath}`);
    }
    const names = new Set<string>();
    for (const project of parsed.projects) {
        if (!project.name || !project.path || names.has(project.name)) {
            throw new Error(`Invalid or duplicate HarmonyRealApps project: ${project.name}`);
        }
        names.add(project.name);
    }
    return parsed.projects;
}

function discoverSdks(sdkRoot: string): Sdk[] {
    const candidates = [
        { name: 'ohosSdk', path: path.join(sdkRoot, 'openharmony/ets') },
        { name: 'hmsSdk', path: path.join(sdkRoot, 'hms/ets') },
    ];
    const sdks = candidates
        .filter(candidate => fs.existsSync(candidate.path) && fs.statSync(candidate.path).isDirectory())
        .map(candidate => ({ ...candidate, moduleName: '' }));
    if (sdks.length === 0) {
        throw new Error(
            `No ETS SDK found below ${sdkRoot}; expected openharmony/ets or hms/ets`
        );
    }
    return sdks;
}

function isInside(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function locationRecord(
    projectPath: string,
    location: { filePath: string; line: number; col: number }
): LocationRecord {
    const absolutePath = path.resolve(location.filePath);
    return {
        file: isInside(projectPath, absolutePath)
            ? path.relative(projectPath, absolutePath).split(path.sep).join('/')
            : absolutePath,
        line: location.line,
        col: location.col,
    };
}

function emptyProjectResult(metadata: ProjectMetadata): ProjectResult {
    return {
        name: metadata.name,
        status: 'failed',
        projectFiles: 0,
        classes: 0,
        methods: 0,
        diagnosticCount: 0,
        reachedStatements: 0,
        reachedFacts: 0,
        totalTimeMs: 0,
        analysisTimeMs: 0,
        peakRssMB: null,
        diagnostics: [],
    };
}

function analyzeProject(
    metadata: ProjectMetadata,
    options: Options,
    sdks: Sdk[]
): ProjectResult {
    const projectPath = path.resolve(options.realAppsRoot, metadata.path);
    const record = emptyProjectResult(metadata);
    const totalStart = Date.now();
    try {
        if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
            throw new Error(`Project directory not found: ${projectPath}`);
        }

        const config = new SceneConfig();
        config.buildConfig(metadata.name, projectPath, sdks);
        config.buildFromProjectDir(projectPath);
        const scene = new Scene();

        scene.buildSceneFromProjectDir(config);
        scene.inferTypes();

        const analysisStart = Date.now();
        const result = new NullnessAnalysisRunner(scene, {
            lifecycleModel: options.lifecycleModel,
            collectSolverStatistics: options.collectSolverStatistics,
            analyzeModuleInitializers: !options.lifecycleRootOnly,
            analyzeFrameworkSinkMethods: !options.lifecycleRootOnly,
            problem: {
                maxAccessPathLength: options.maxAccessPathLength,
                maxPropagationDepth: options.maxPropagationDepth,
            },
        }).runFromDummyMain();
        record.analysisTimeMs = Date.now() - analysisStart;

        const projectFiles = scene.getFiles().filter(file => {
            const filePath = file.getFilePath();
            return filePath.length > 0 && isInside(projectPath, path.resolve(filePath));
        }).length;
        record.projectFiles = projectFiles;
        record.classes = scene.getClasses().length;
        record.methods = scene.getMethods().length;
        record.reachedStatements = result.reachedFacts.size;
        record.reachedFacts = [...result.reachedFacts.values()]
            .reduce((sum, facts) => sum + facts.length, 0);
        record.solverStatistics = result.solverStatistics;
        record.solverBreakdown = result.solverBreakdown;
        record.lifecycleModelStatistics = result.lifecycleModelStatistics;
        record.diagnostics = result.diagnostics.map(diagnostic => ({
            nullness: diagnostic.nullness,
            accessPath: diagnostic.accessPath.toString(),
            description: diagnostic.description,
            confidence: diagnostic.confidence,
            source: locationRecord(projectPath, diagnostic.sourceLocation),
            dereference: locationRecord(projectPath, diagnostic.dereferenceLocation),
        }));
        record.diagnosticCount = record.diagnostics.length;
        if (!result.success) {
            throw new Error(result.error ?? 'Nullness analysis failed without an error message');
        }
        record.status = 'success';
    } catch (error) {
        record.status = 'failed';
        record.error = error instanceof Error ? error.stack ?? error.message : String(error);
    } finally {
        record.totalTimeMs = Date.now() - totalStart;
        // Node reports maxRSS in KiB. Because each project runs in an isolated
        // worker, this is the peak resident memory of one complete analysis.
        record.peakRssMB = Number((process.resourceUsage().maxRSS / 1024).toFixed(2));
    }
    return record;
}

function writeJsonAtomic(outputPath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const temporaryPath = `${outputPath}.tmp-${process.pid}`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, outputPath);
}

function average(values: number[]): number {
    if (values.length === 0) return 0;
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function updateSummary(report: RealAppsReport): void {
    const successes = report.projects.filter(project => project.status === 'success');
    const peakRssValues = successes
        .map(project => project.peakRssMB)
        .filter((value): value is number => value !== null);
    report.updatedAt = new Date().toISOString();
    report.summary = {
        selectedProjects: report.summary.selectedProjects,
        completedProjects: report.projects.length,
        successfulProjects: successes.length,
        failedProjects: report.projects.filter(project => project.status === 'failed').length,
        timedOutProjects: report.projects.filter(project => project.status === 'timeout').length,
        projectsWithDiagnostics: successes.filter(project => project.diagnosticCount > 0).length,
        diagnosticCount: successes.reduce(
            (sum, project) => sum + project.diagnosticCount,
            0
        ),
        averageTotalTimeMs: average(successes.map(project => project.totalTimeMs)),
        averageNullnessAnalysisTimeMs: average(
            successes.map(project => project.analysisTimeMs)
        ),
        totalIFDSSolveTimeMs: successes.reduce(
            (sum, project) => sum + (project.solverStatistics?.solveTimeMs ?? 0),
            0
        ),
        averageIFDSSolveTimeMs: average(
            successes.map(project => project.solverStatistics?.solveTimeMs ?? 0)
        ),
        totalLifecycleIFDSSolveTimeMs: successes.reduce(
            (sum, project) => sum +
                (project.solverBreakdown?.lifecycle?.solveTimeMs ?? 0),
            0
        ),
        totalSupplementalIFDSSolveTimeMs: successes.reduce(
            (sum, project) => sum +
                (project.solverBreakdown?.supplemental?.solveTimeMs ?? 0),
            0
        ),
        supplementalRootCount: successes.reduce(
            (sum, project) => sum +
                (project.solverBreakdown?.supplementalRootCount ?? 0),
            0
        ),
        averagePeakRssMB: average(peakRssValues),
        maxPeakRssMB: peakRssValues.length > 0 ? Math.max(...peakRssValues) : 0,
    };
}

function createReport(
    options: Options,
    selected: ProjectMetadata[]
): RealAppsReport {
    const now = new Date().toISOString();
    return {
        schemaVersion: 3,
        analysisKind: 'null-dereference',
        updatedAt: now,
        completed: false,
        settings: {
            sdkRoot: options.sdkRoot,
            timeoutMs: options.timeoutMs,
            lifecycleModel: options.lifecycleModel,
            collectSolverStatistics: options.collectSolverStatistics,
            lifecycleRootOnly: options.lifecycleRootOnly,
            maxAccessPathLength: options.maxAccessPathLength,
            maxPropagationDepth: options.maxPropagationDepth,
        },
        summary: {
            selectedProjects: selected.length,
            completedProjects: 0,
            successfulProjects: 0,
            failedProjects: 0,
            timedOutProjects: 0,
            projectsWithDiagnostics: 0,
            diagnosticCount: 0,
            averageTotalTimeMs: 0,
            averageNullnessAnalysisTimeMs: 0,
            totalIFDSSolveTimeMs: 0,
            averageIFDSSolveTimeMs: 0,
            totalLifecycleIFDSSolveTimeMs: 0,
            totalSupplementalIFDSSolveTimeMs: 0,
            supplementalRootCount: 0,
            averagePeakRssMB: 0,
            maxPeakRssMB: 0,
        },
        projects: [],
    };
}

function runWorker(options: Options): void {
    if (!options.workerProject || !options.workerResult) {
        throw new Error('Worker mode requires --worker-project and --worker-result');
    }
    const metadata = loadMetadata(options.realAppsRoot)
        .find(project => project.name === options.workerProject);
    if (!metadata) {
        throw new Error(`Unknown worker project: ${options.workerProject}`);
    }
    const record = analyzeProject(metadata, options, discoverSdks(options.sdkRoot));
    writeJsonAtomic(options.workerResult, record);
    process.exitCode = record.status === 'success' ? 0 : 1;
}

function selectProjects(
    metadata: ProjectMetadata[],
    options: Options
): ProjectMetadata[] {
    let selected = metadata;
    if (options.projects.length > 0) {
        const requested = new Set(options.projects);
        selected = metadata.filter(project => requested.has(project.name));
        const unknown = options.projects.filter(name => !selected.some(project => project.name === name));
        if (unknown.length > 0) {
            throw new Error(
                `Unknown project(s): ${unknown.join(', ')}. Use --list to show available names.`
            );
        }
    }
    if (options.limit !== undefined) {
        selected = selected.slice(0, options.limit);
    }
    return selected;
}

function runParent(options: Options): void {
    const metadata = loadMetadata(options.realAppsRoot);
    if (options.listOnly) {
        for (const project of metadata) {
            const projectPath = path.resolve(options.realAppsRoot, project.path);
            console.log(
                `${project.name}\t${fs.existsSync(projectPath) ? 'ready' : 'missing'}\t` +
                `${project.resolvedCommit}\t${project.path}`
            );
        }
        console.log(`Total: ${metadata.length}`);
        return;
    }

    if (!fs.existsSync(viteNodePath)) {
        throw new Error(`vite-node runner not found: ${viteNodePath}`);
    }
    const sdks = discoverSdks(options.sdkRoot);
    const selected = selectProjects(metadata, options);
    if (selected.length === 0) {
        throw new Error('No HarmonyRealApps projects selected');
    }
    const report = createReport(options, selected);
    console.log(
        `Nullness real-project evaluation: projects=${selected.length}, ` +
        `model=${options.lifecycleModel}, sdk=${options.sdkRoot}, ` +
        `root=${options.lifecycleRootOnly ? 'lifecycle-only' : 'all'}, ` +
        `timeout=${options.timeoutMs}ms`
    );

    selected.forEach((metadataItem, index) => {
        const resultPath = path.join(
            os.tmpdir(),
            `ark-nullness-real-${process.pid}-${Date.now()}-${index}.json`
        );
        console.log(`[${index + 1}/${selected.length}] ${metadataItem.name}`);
        const child = spawnSync(
            process.execPath,
            [
                viteNodePath,
                scriptPath,
                '--worker-project', metadataItem.name,
                '--worker-result', resultPath,
                '--real-apps-root', options.realAppsRoot,
                '--sdk-root', options.sdkRoot,
                '--lifecycle-model', options.lifecycleModel,
                '--max-access-path-length', String(options.maxAccessPathLength),
                '--max-propagation-depth', String(options.maxPropagationDepth),
                ...(options.collectSolverStatistics ? ['--ifds-stats'] : []),
                ...(options.lifecycleRootOnly ? ['--lifecycle-root-only'] : []),
            ],
            {
                cwd: repositoryRoot,
                encoding: 'utf8',
                timeout: options.timeoutMs,
                // The analysis is CPU-bound and may not return to the event loop in
                // time to handle SIGTERM. SIGKILL gives the per-project timeout hard
                // termination semantics and cannot be intercepted by the worker.
                killSignal: 'SIGKILL',
                maxBuffer: 16 * 1024 * 1024,
                env: {
                    ...process.env,
                    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=4096`.trim(),
                },
            }
        );

        let record: ProjectResult;
        if (fs.existsSync(resultPath)) {
            record = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as ProjectResult;
        } else {
            record = emptyProjectResult(metadataItem);
            if ((child.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') {
                record.status = 'timeout';
                record.error = `Timed out after ${options.timeoutMs}ms`;
                record.totalTimeMs = options.timeoutMs;
            } else {
                record.error = child.error?.message ??
                    child.stderr?.trim() ??
                    `Worker exited with status ${child.status ?? 'signal'}`;
            }
        }
        fs.rmSync(resultPath, { force: true });
        report.projects.push(record);
        updateSummary(report);
        if (options.outputPath) {
            writeJsonAtomic(options.outputPath, report);
        }
        console.log(
            `  ${record.status.toUpperCase()} diagnostics=${record.diagnosticCount} ` +
            `time=${record.totalTimeMs}ms analysis=${record.analysisTimeMs}ms ` +
            `ifds=${record.solverStatistics?.solveTimeMs ?? 'n/a'}ms ` +
            `lifecycle=${record.solverBreakdown?.lifecycle?.solveTimeMs ?? 'n/a'}ms ` +
            `supplemental=${record.solverBreakdown?.supplemental?.solveTimeMs ?? 0}ms ` +
            `cfg=${record.lifecycleModelStatistics?.blocks ?? 'n/a'}/` +
            `${record.lifecycleModelStatistics?.edges ?? 'n/a'}`
        );
        if (record.error) {
            console.log(`  error: ${record.error.split(/\r?\n/)[0]}`);
        }
    });

    report.completed = true;
    updateSummary(report);
    if (options.outputPath) {
        writeJsonAtomic(options.outputPath, report);
        console.log(`Report written to: ${options.outputPath}`);
    }
    console.log('Nullness real-project summary:');
    console.log(JSON.stringify(report.summary, null, 2));
    if (report.summary.failedProjects > 0 || report.summary.timedOutProjects > 0) {
        process.exitCode = 1;
    }
}

try {
    const options = parseArgs(process.argv.slice(2));
    if (options.workerProject || options.workerResult) {
        runWorker(options);
    } else {
        runParent(options);
    }
} catch (error) {
    console.error(
        `test-nullness-real-apps: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
}
