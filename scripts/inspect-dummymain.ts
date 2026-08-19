#!/usr/bin/env -S npx vite-node

/**
 * Print the lifecycle DummyMain for one project in IR and model-source form.
 *
 * The source form is intentionally pseudo ArkTS: it reconstructs the calls
 * emitted by LifecycleModelCreator, rather than pretending to be source code
 * recovered from the original project.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sdk } from 'arkanalyzer/lib/Config';
import { Scene, SceneConfig, SourceMethodPrinter } from 'arkanalyzer/lib/';
import { Stmt } from 'arkanalyzer/lib/core/base/Stmt';
import type { ArkMethod } from 'arkanalyzer/lib/core/model/ArkMethod';
import { LifecycleModelCreator } from '../src/lifecycle/LifecycleModelCreator';
import { DEFAULT_LIFECYCLE_CONFIG } from '../src/lifecycle/LifecycleTypes';

type OutputFormat = 'ir' | 'source' | 'both';

interface Options {
    projectPath: string;
    format: OutputFormat;
    sdkRoot?: string;
    sdkPaths: string[];
    inferTypes: boolean;
    callbackIterations: number;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const defaultSdkRoot = path.join(projectRoot, 'sdk/default');

function help(): void {
    console.log([
        'Usage:',
        '  npm run inspect:dummymain -- <absolute-project-path> [options]',
        '',
        'Options:',
        '  --format <ir|source|both>  Output format; default: both',
        '  --sdk-root <path>          Use openharmony/ets and hms/ets below an SDK root',
        '  --sdk <ets-path>           Use an ETS SDK path; repeatable',
        '  --callback-iterations <n>  DummyMain lifecycle expansion rounds; default: 1',
        '  --no-infer-types           Skip Scene type inference',
        '  -h, --help                 Show this help',
        '',
        `Default SDK root: ${defaultSdkRoot}`,
        'Explicit --sdk-root or --sdk options override the default.',
        'The sdk/ directory is git-ignored; after cloning, copy the SDK to sdk/default',
        'or provide its location with --sdk-root/--sdk.',
        '',
        'Example:',
        '  npm run inspect:dummymain -- /abs/path/to/ArkDefectBench/Null\\ Pointer\\ Dereference/Lifecycle/PageLifecycle/HideShow --format both',
    ].join('\n'));
}

function value(args: string[], index: number, option: string): string {
    const result = args[index + 1];
    if (!result || result.startsWith('--')) throw new Error(`${option} requires a value`);
    return result;
}

function parseArgs(args: string[]): Options {
    let projectPath: string | undefined;
    let format: OutputFormat = 'both';
    let sdkRoot: string | undefined;
    const sdkPaths: string[] = [];
    let inferTypes = true;
    let callbackIterations = 1;

    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '-h' || arg === '--help') {
            help();
            process.exit(0);
        }
        if (arg === '--format') {
            format = value(args, index, arg) as OutputFormat;
            index++;
            continue;
        }
        if (arg.startsWith('--format=')) {
            format = arg.slice('--format='.length) as OutputFormat;
            continue;
        }
        if (arg === '--sdk-root') {
            sdkRoot = value(args, index, arg);
            index++;
            continue;
        }
        if (arg.startsWith('--sdk-root=')) {
            sdkRoot = arg.slice('--sdk-root='.length);
            continue;
        }
        if (arg === '--sdk') {
            sdkPaths.push(value(args, index, arg));
            index++;
            continue;
        }
        if (arg.startsWith('--sdk=')) {
            sdkPaths.push(arg.slice('--sdk='.length));
            continue;
        }
        if (arg === '--callback-iterations') {
            callbackIterations = Number(value(args, index, arg));
            index++;
            continue;
        }
        if (arg.startsWith('--callback-iterations=')) {
            callbackIterations = Number(arg.slice('--callback-iterations='.length));
            continue;
        }
        if (arg === '--no-infer-types') {
            inferTypes = false;
            continue;
        }
        if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
        if (projectPath) throw new Error(`Unexpected positional argument: ${arg}`);
        projectPath = arg;
    }

    if (!projectPath) throw new Error('Missing project path. Use --help for usage.');
    if (!path.isAbsolute(projectPath)) {
        throw new Error(`Project path must be absolute: ${projectPath}`);
    }
    if (!['ir', 'source', 'both'].includes(format)) {
        throw new Error(`Invalid --format: ${format}; expected ir, source, or both`);
    }
    if (!Number.isInteger(callbackIterations) || callbackIterations < 1) {
        throw new Error(`--callback-iterations must be a positive integer: ${callbackIterations}`);
    }
    return { projectPath, format, sdkRoot, sdkPaths, inferTypes, callbackIterations };
}

function discoverSdks(options: Options): Sdk[] {
    const sdkRoot = options.sdkRoot
        ? path.resolve(options.sdkRoot)
        : options.sdkPaths.length === 0
            ? defaultSdkRoot
            : undefined;
    const candidates = sdkRoot
        ? [
            ['ohosSdk', path.join(sdkRoot, 'openharmony/ets')],
            ['hmsSdk', path.join(sdkRoot, 'hms/ets')],
        ] as const
        : options.sdkPaths.map((sdk, index) => [`sdk${index + 1}`, path.resolve(sdk)] as const);

    const seen = new Set<string>();
    const result: Sdk[] = [];
    for (const [name, candidate] of candidates) {
        if (!fs.existsSync(candidate)) {
            if (sdkRoot) continue;
            throw new Error(`SDK path does not exist: ${candidate}`);
        }
        if (!fs.statSync(candidate).isDirectory()) throw new Error(`SDK path is not a directory: ${candidate}`);
        if (!seen.has(candidate)) {
            seen.add(candidate);
            result.push({ name, path: candidate, moduleName: '' });
        }
    }
    if (result.length === 0) {
        if (!options.sdkRoot && options.sdkPaths.length === 0) {
            throw new Error(
                `Default SDK not found below ${defaultSdkRoot}. ` +
                'The sdk/ directory is not tracked by git; copy the SDK to sdk/default ' +
                'or pass --sdk-root <path> / --sdk <ets-path>.'
            );
        }
        throw new Error(`No ETS SDK found below SDK root: ${sdkRoot}`);
    }
    return result;
}

function formatIr(stmt: Stmt, index: number): string[] {
    const lines = [`    [${index}] ${stmt.constructor.name}: ${stmt.toString()}`];
    const source = stmt.getOriginalText?.();
    lines.push(`        source: ${source ?? '<synthetic>'}`);
    return lines;
}

function appendIr(lines: string[], method: { getCfg: () => any }): void {
    const cfg = method.getCfg();
    if (!cfg) {
        lines.push('  <no CFG>');
        return;
    }
    const blocks = [...cfg.getBlocks()];
    const indices = new Map(blocks.map((block: any, index: number) => [block, index]));
    for (const [index, block] of blocks.entries()) {
        const successors = block.getSuccessors()
            .map((successor: any) => `B${indices.get(successor) ?? '?'}`).join(', ');
        lines.push(`  B${index} -> [${successors}]`);
        block.getStmts().forEach((stmt: Stmt, stmtIndex: number) => lines.push(...formatIr(stmt, stmtIndex)));
    }
}

function instanceName(typeName: string): string {
    const simpleName = typeName.split('.').at(-1) ?? typeName;
    return simpleName.charAt(0).toLowerCase() + simpleName.slice(1);
}

/**
 * ArkAnalyzer recovers the CFG structure, while these small rewrites remove
 * synthetic IR spelling that is distracting in a human-facing DummyMain.
 */
function makeSourceReadable(source: string): string {
    const instances = new Map<string, string>();
    const readable = source.split('\n').map(line => {
        if (/^\s*@extendedDummyMain\(\)\s*\{$/.test(line)) {
            return 'function dummyMain(): void {';
        }
        if (/^\s*count = 0;$/.test(line)) {
            return '  const lifecycleBranch = nondeterministicInt(); // analysis-only choice';
        }

        line = line.replace(/\bcount == /g, 'lifecycleBranch === ');
        line = line.replace(/\.\%statInit\(\);$/, '.__staticInit();');

        const constructor = line.match(/^(\s*)(?:new )?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(\)\.constructor\(\);$/);
        if (constructor) {
            const [, indent, typeName] = constructor;
            const variable = instanceName(typeName);
            instances.set(typeName, variable);
            return `${indent}const ${variable} = new ${typeName}();`;
        }

        for (const [typeName, variable] of instances) {
            const escapedType = typeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            line = line.replace(new RegExp(`\\b(?:new )?${escapedType}\\(\\)\\.`), `${variable}.`);
        }
        line = line.replace(/%param(\d+)/g, 'param$1');

        const callback = line.match(/^(\s*.*)\.%AM(\d+)\$([A-Za-z_$][\w$]*)\((.*)\);$/);
        if (callback) {
            const [, receiver, index, owner, args] = callback;
            return `${receiver}.${owner}Callback${index}(${args}); // synthetic UI callback: %AM${index}$${owner}`;
        }
        return line;
    }).join('\n').trimEnd();
    const parameters = [...new Set(
        [...readable.matchAll(/\bparam(\d+)\b/g)].map(match => Number(match[1]))
    )].sort((left, right) => left - right);
    const parameterList = parameters.map(index => `param${index}: unknown`).join(', ');
    return readable.replace('function dummyMain(): void {', `function dummyMain(${parameterList}): void {`);
}

function appendSource(lines: string[], method: ArkMethod): void {
    const cfg = method.getCfg();
    if (!cfg) {
        lines.push('  <no CFG>');
        return;
    }
    [...cfg.getBlocks()].forEach((block, index) => block.setId(index));
    lines.push(makeSourceReadable(new SourceMethodPrinter(method).dump()));
    lines.push('', '// Reconstructed lifecycle-model pseudocode; not original ArkTS source.');
}

function main(): void {
    const options = parseArgs(process.argv.slice(2));
    const projectPath = path.resolve(options.projectPath);
    if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
        throw new Error(`Project path is not a directory: ${projectPath}`);
    }
    const sdks = discoverSdks(options);
    const config = new SceneConfig();
    config.buildConfig(path.basename(projectPath), projectPath, sdks);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    if (options.inferTypes) scene.inferTypes();
    const creator = new LifecycleModelCreator(scene, {
        bounds: {
            ...DEFAULT_LIFECYCLE_CONFIG.bounds,
            maxCallbackIterations: options.callbackIterations,
        },
    });
    creator.create();
    const dummyMain = creator.getDummyMain();
    const header = [
        'LIFECYCLE DUMMYMAIN INSPECTION',
        `PROJECT: ${projectPath}`,
        `FORMAT: ${options.format}`,
        `CALLBACK_ITERATIONS: ${options.callbackIterations}`,
        `SDK: ${sdks.map(sdk => `${sdk.name}=${sdk.path}`).join(', ')}`,
        '',
        `METHOD ${dummyMain.getSignature().toString()}`,
    ];
    const output: string[] = [...header];
    if (options.format === 'ir' || options.format === 'both') {
        output.push('', '================ IR ================');
        appendIr(output, dummyMain);
    }
    if (options.format === 'source' || options.format === 'both') {
        output.push('', '================ MODEL PSEUDOCODE ================');
        appendSource(output, dummyMain);
    }
    process.stdout.write(`${output.join('\n')}\n`);
}

try {
    main();
} catch (error) {
    console.error(`inspect-dummymain: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
}
