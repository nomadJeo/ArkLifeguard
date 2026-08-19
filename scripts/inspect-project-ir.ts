#!/usr/bin/env -S npx vite-node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sdk } from 'arkanalyzer/lib/Config';
import { Scene, SceneConfig } from 'arkanalyzer/lib/';
import type { Stmt } from 'arkanalyzer/lib/core/base/Stmt';
import type { ArkMethod } from 'arkanalyzer/lib/core/model/ArkMethod';

interface Options {
    projectPath: string;
    sdkPaths: string[];
    sdkRoot?: string;
    methodFilter?: string;
    outputPath?: string;
    inferTypes: boolean;
    verboseIr: boolean;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const defaultSdkRoot = path.join(projectRoot, 'sdk/default');

function printHelp(): void {
    console.log([
        'Usage:',
        '  npm run inspect:project-ir -- <project-path> [options]',
        '',
        'Options:',
        '  --sdk <ets-path>       Use an ETS SDK path; may be specified more than once',
        '  --sdk-root <path>      Use openharmony/ets and hms/ets below an SDK root',
        '  --method <text>        Print only method signatures containing this text',
        '  --output <file>        Write output to a file instead of stdout',
        '  --no-infer-types       Skip Scene type inference',
        '  --verbose-ir           Include source text, defs, and uses for each statement',
        '  -h, --help             Show this help',
        '',
        `Default SDK root: ${defaultSdkRoot}`,
        'Explicit --sdk-root or --sdk options override the default.',
        'The sdk/ directory is git-ignored; after cloning, copy the SDK to sdk/default',
        'or provide its location with --sdk-root/--sdk.',
        '',
        'Examples:',
        '  npm run inspect:project-ir -- "../../../ArkLifeguard/ArkDefectBench/Null Pointer Dereference/BasicNull/DirectNull"',
        '  npm run inspect:project-ir -- ../../../ArkLifeguard/Demo4tests/OxHornCampus --sdk-root ../../../hapflow_artifact/sdk/default',
        '  npm run inspect:project-ir -- ../../../ArkLifeguard/Demo4tests/OxHornCampus --method EntryAbility --verbose-ir',
    ].join('\n'));
}

function requireOptionValue(args: string[], index: number, option: string): string {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`${option} requires a value`);
    }
    return value;
}

function parseArgs(args: string[]): Options {
    let projectPath: string | undefined;
    const sdkPaths: string[] = [];
    let sdkRoot: string | undefined;
    let methodFilter: string | undefined;
    let outputPath: string | undefined;
    let inferTypes = true;
    let verboseIr = false;

    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '-h' || arg === '--help') {
            printHelp();
            process.exit(0);
        }
        if (arg === '--sdk') {
            sdkPaths.push(requireOptionValue(args, index, arg));
            index++;
            continue;
        }
        if (arg.startsWith('--sdk=')) {
            sdkPaths.push(arg.slice('--sdk='.length));
            continue;
        }
        if (arg === '--sdk-root') {
            sdkRoot = requireOptionValue(args, index, arg);
            index++;
            continue;
        }
        if (arg.startsWith('--sdk-root=')) {
            sdkRoot = arg.slice('--sdk-root='.length);
            continue;
        }
        if (arg === '--method') {
            methodFilter = requireOptionValue(args, index, arg);
            index++;
            continue;
        }
        if (arg.startsWith('--method=')) {
            methodFilter = arg.slice('--method='.length);
            continue;
        }
        if (arg === '--output') {
            outputPath = requireOptionValue(args, index, arg);
            index++;
            continue;
        }
        if (arg.startsWith('--output=')) {
            outputPath = arg.slice('--output='.length);
            continue;
        }
        if (arg === '--no-infer-types') {
            inferTypes = false;
            continue;
        }
        if (arg === '--verbose-ir') {
            verboseIr = true;
            continue;
        }
        if (arg.startsWith('-')) {
            throw new Error(`Unknown option: ${arg}`);
        }
        if (projectPath) {
            throw new Error(`Unexpected positional argument: ${arg}`);
        }
        projectPath = arg;
    }

    if (!projectPath) {
        throw new Error('Missing project path. Use --help for usage.');
    }
    return {
        projectPath,
        sdkPaths,
        sdkRoot,
        methodFilter,
        outputPath,
        inferTypes,
        verboseIr,
    };
}

function discoverSdks(options: Options): Sdk[] {
    const candidates: Array<{ name: string; sdkPath: string }> = [];
    const sdkRoot = options.sdkRoot
        ? path.resolve(options.sdkRoot)
        : options.sdkPaths.length === 0
            ? defaultSdkRoot
            : undefined;
    if (sdkRoot) {
        candidates.push(
            { name: 'ohosSdk', sdkPath: path.join(sdkRoot, 'openharmony/ets') },
            { name: 'hmsSdk', sdkPath: path.join(sdkRoot, 'hms/ets') }
        );
    } else {
        options.sdkPaths.forEach((sdkPath, index) => {
            candidates.push({ name: `sdk${index + 1}`, sdkPath: path.resolve(sdkPath) });
        });
    }

    const seen = new Set<string>();
    const sdks: Sdk[] = [];
    for (const candidate of candidates) {
        const resolved = path.resolve(candidate.sdkPath);
        if (!fs.existsSync(resolved)) {
            if (sdkRoot) {
                continue;
            }
            throw new Error(`SDK path does not exist: ${resolved}`);
        }
        if (!fs.statSync(resolved).isDirectory()) {
            throw new Error(`SDK path is not a directory: ${resolved}`);
        }
        if (seen.has(resolved)) {
            continue;
        }
        seen.add(resolved);
        sdks.push({ name: candidate.name, path: resolved, moduleName: '' });
    }
    if (sdks.length === 0) {
        if (!options.sdkRoot && options.sdkPaths.length === 0) {
            throw new Error(
                `Default SDK not found below ${defaultSdkRoot}. ` +
                'The sdk/ directory is not tracked by git; copy the SDK to sdk/default ' +
                'or pass --sdk-root <path> / --sdk <ets-path>.'
            );
        }
        throw new Error(`No ETS SDK found below SDK root: ${sdkRoot}`);
    }
    return sdks;
}

function isInside(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function formatValue(value: unknown): string {
    if (!value || typeof value !== 'object') {
        return String(value);
    }
    const candidate = value as { constructor?: { name?: string }; toString?: () => string };
    return `${candidate.constructor?.name ?? '<unknown>'}:${candidate.toString?.() ?? String(value)}`;
}

function appendStatement(lines: string[], stmt: Stmt, index: number, verbose: boolean): void {
    lines.push(`    [${index}] ${stmt.constructor.name}: ${stmt.toString()}`);
    if (!verbose) {
        return;
    }
    lines.push(`        source: ${stmt.getOriginalText() ?? '<synthetic>'}`);
    const defined = stmt.getDef();
    lines.push(`        def   : ${defined ? formatValue(defined) : '<none>'}`);
    const uses = stmt.getUses();
    lines.push(`        uses  : ${uses.length > 0 ? uses.map(formatValue).join(' | ') : '<none>'}`);
}

function appendCfg(lines: string[], method: ArkMethod, verbose: boolean): void {
    const cfg = method.getCfg();
    if (!cfg) {
        lines.push('  <no CFG>');
        return;
    }
    const blocks = [...cfg.getBlocks()];
    const blockIndices = new Map(blocks.map((block, index) => [block, index]));
    for (const [blockIndex, block] of blocks.entries()) {
        const successors = block.getSuccessors()
            .map(successor => `B${blockIndices.get(successor) ?? '?'}`)
            .join(', ');
        lines.push(`  B${blockIndex} -> [${successors}]`);
        block.getStmts().forEach((stmt, stmtIndex) => {
            appendStatement(lines, stmt, stmtIndex, verbose);
        });
    }
}

function getProjectMethods(scene: Scene, projectPath: string): ArkMethod[] {
    return scene.getMethods()
        .filter(method => {
            const filePath = method.getDeclaringArkFile().getFilePath();
            return filePath.length > 0 && isInside(projectPath, path.resolve(filePath));
        })
        .sort((left, right) => left.getSignature().toString()
            .localeCompare(right.getSignature().toString()));
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
    if (options.inferTypes) {
        scene.inferTypes();
    }

    const allProjectMethods = getProjectMethods(scene, projectPath);
    const methods = options.methodFilter
        ? allProjectMethods.filter(method => method.getSignature().toString()
            .includes(options.methodFilter!))
        : allProjectMethods;

    const lines: string[] = [
        'ARK PROJECT IR INSPECTION',
        `PROJECT: ${projectPath}`,
        `SDK: ${sdks.map(sdk => `${sdk.name}=${sdk.path}`).join(', ')}`,
        `TYPE_INFERENCE: ${options.inferTypes ? 'enabled' : 'disabled'}`,
        `SCENE: classes=${scene.getClasses().length}, methods=${scene.getMethods().length}`,
        `SDK_FILES: loaded=${scene.getSdkArkFiles().length}, unhandled=${scene.getUnhandledSdkFilePaths().length}`,
        `PROJECT_METHODS: total=${allProjectMethods.length}, printed=${methods.length}`,
    ];
    lines.push('', '================ PROJECT IR ================');

    for (const method of methods) {
        const filePath = method.getDeclaringArkFile().getFilePath();
        lines.push(
            '',
            `FILE ${path.relative(projectPath, filePath)}`,
            `METHOD ${method.getSignature().toString()}`
        );
        appendCfg(lines, method, options.verboseIr);
    }
    if (methods.length === 0) {
        lines.push('', '<no project method matched>');
    }

    const output = `${lines.join('\n')}\n`;
    if (options.outputPath) {
        const outputPath = path.resolve(options.outputPath);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, output, 'utf8');
        console.log(`Wrote project IR to ${outputPath}`);
        return;
    }
    process.stdout.write(output);
}

try {
    main();
} catch (error) {
    console.error(`inspect-project-ir: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
}
