/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

import path from 'node:path';
import {
    Command,
    CommanderError,
    InvalidArgumentError,
    Option,
} from 'commander';
import { ProjectAnalysisOptions, ProjectAnalyzer } from '../application';
import { ReportFormat, ReportGenerator } from '../report';

const VERSION = '0.1.0';
const NAME = 'arklifeguard';

interface AnalyzeCliOptions {
    output?: string;
    format: ReportFormat;
    sdkRoot?: string;
    sdk: string[];
    inferTypes: boolean;
    navigation: boolean;
    uiCallbacks: boolean;
    nullness: boolean;
    resourceAnalysis: boolean;
    maxCallbackIterations: number;
    maxAbilitiesPerFlow: number;
    maxNavigationHops: number;
    maxAccessPathLength: number;
    maxPropagationDepth: number;
    reportUnresolvedReturns: boolean;
    detailed: boolean;
    title?: string;
    verbose: boolean;
}

export async function runCLI(argv: string[] = process.argv): Promise<number> {
    let exitCode = 0;
    const program = new Command();
    program
        .name(NAME)
        .version(VERSION)
        .description('HarmonyOS lifecycle, resource-leak and null-pointer static analyzer');

    const analyzeCommand = program.command('analyze')
        .description('Run the complete Scene -> lifecycle -> resource/nullness -> report pipeline')
        .argument('<project-path>', 'HarmonyOS project directory')
        .option('-o, --output <path>', 'write the report to a file')
        .addOption(new Option('-f, --format <format>', 'report format')
            .choices(['json', 'text', 'html', 'markdown']).default('text'))
        .option('--sdk-root <path>', 'SDK root containing openharmony/ets and/or hms/ets')
        .option('--sdk <path>', 'ETS SDK directory; repeatable', collect, [])
        .option('--no-infer-types', 'skip ArkAnalyzer type inference')
        .option('--no-navigation', 'skip navigation relationship collection')
        .option('--no-ui-callbacks', 'disable ViewTree UI callback extraction')
        .option('--no-nullness', 'build the lifecycle model without running nullness IFDS')
        .option('--no-resource-analysis', 'disable resource Source/Sink IFDS analysis')
        .option('--max-callback-iterations <n>', 'bounded lifecycle expansion rounds', positiveInteger, 1)
        .option('--max-abilities-per-flow <n>', 'maximum Abilities visited by one resource flow', nonNegativeInteger, 3)
        .option('--max-navigation-hops <n>', 'maximum navigation hops in one resource flow', nonNegativeInteger, 5)
        .option('--max-access-path-length <n>', 'maximum nullness access-path length', positiveInteger, 5)
        .option('--max-propagation-depth <n>', 'maximum resource/nullness fact propagation depth', positiveInteger, 40)
        .option('--report-unresolved-returns', 'include low-confidence unresolved-return reports', false)
        .option('-d, --detailed', 'include lifecycle and navigation details', false)
        .option('--title <title>', 'custom report title')
        .option('-v, --verbose', 'show lifecycle analysis logs', false)
        .action(async (projectPath: string, options: AnalyzeCliOptions) => {
            try {
                const analysisOptions: ProjectAnalysisOptions = {
                    ...(options.sdkRoot ? { sdkRoot: path.resolve(options.sdkRoot) } : {}),
                    sdkPaths: options.sdk.map(value => path.resolve(value)),
                    inferTypes: options.inferTypes,
                    analyzeNavigation: options.navigation,
                    extractUICallbacks: options.uiCallbacks,
                    runNullness: options.nullness,
                    runResourceAnalysis: options.resourceAnalysis,
                    maxCallbackIterations: options.maxCallbackIterations,
                    maxAbilitiesPerFlow: options.maxAbilitiesPerFlow,
                    maxNavigationHops: options.maxNavigationHops,
                    maxAccessPathLength: options.maxAccessPathLength,
                    maxPropagationDepth: options.maxPropagationDepth,
                    reportUnresolvedReturns: options.reportUnresolvedReturns,
                    verbose: options.verbose,
                };
                const result = await new ProjectAnalyzer(analysisOptions).analyze(projectPath);
                const outputPath = options.output ? path.resolve(options.output) : undefined;
                const report = new ReportGenerator().generate(result, {
                    format: options.format,
                    outputPath,
                    detailed: options.detailed,
                    title: options.title,
                });
                if (outputPath) {
                    console.log(`Report written to: ${outputPath}`);
                } else {
                    console.log(report);
                }
                if (result.status !== 'success') exitCode = 2;
            } catch (error) {
                console.error(error instanceof Error ? error.message : String(error));
                if (options.verbose && error instanceof Error && error.stack) {
                    console.error(error.stack);
                }
                exitCode = 1;
            }
        });
    analyzeCommand.exitOverride();

    program.command('version')
        .description('show version information')
        .action(() => console.log(`${NAME} v${VERSION}`));

    program.exitOverride();
    try {
        await program.parseAsync(argv);
    } catch (error) {
        if (error instanceof CommanderError) {
            if (error.code === 'commander.helpDisplayed' ||
                error.code === 'commander.version') return 0;
            return 1;
        }
        throw error;
    }
    return exitCode;
}

function collect(value: string, previous: string[]): string[] {
    return [...previous, value];
}

function positiveInteger(value: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new InvalidArgumentError(`expected a positive integer, received: ${value}`);
    }
    return parsed;
}

function nonNegativeInteger(value: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new InvalidArgumentError(`expected a non-negative integer, received: ${value}`);
    }
    return parsed;
}
