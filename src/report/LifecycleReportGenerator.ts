/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ProjectAnalysisResult } from '../application';

export interface LifecycleModelingReport {
    schemaVersion: 1;
    reportKind: 'lifecycle-modeling-details';
    project: ProjectAnalysisResult['project'];
    settings: {
        lifecycleModel: ProjectAnalysisResult['settings']['lifecycleModel'];
        extractUICallbacks: boolean;
        analyzeNavigation: boolean;
        maxCallbackIterations: number;
    };
    summary: {
        abilities: number;
        components: number;
        lifecycleMethods: number;
        uiCallbacks: number;
        navigations: number;
    };
    abilities: ProjectAnalysisResult['abilities'];
    components: ProjectAnalysisResult['components'];
    navigations: ProjectAnalysisResult['navigations'];
    dummyMain: ProjectAnalysisResult['dummyMain'];
    duration: {
        sceneBuilding: number;
        lifecycleModeling: number;
        navigationAnalysis: number;
    };
}

/** Writes lifecycle-modeling details separately from the user-facing report. */
export class LifecycleReportGenerator {
    generate(result: ProjectAnalysisResult, outputPath?: string): string {
        const report: LifecycleModelingReport = {
            schemaVersion: 1,
            reportKind: 'lifecycle-modeling-details',
            project: result.project,
            settings: {
                lifecycleModel: result.settings.lifecycleModel,
                extractUICallbacks: result.settings.extractUICallbacks,
                analyzeNavigation: result.settings.analyzeNavigation,
                maxCallbackIterations: result.settings.bounds.maxCallbackIterations,
            },
            summary: {
                abilities: result.summary.abilities,
                components: result.summary.components,
                lifecycleMethods: result.summary.lifecycleMethods,
                uiCallbacks: result.summary.uiCallbacks,
                navigations: result.summary.navigations,
            },
            abilities: result.abilities,
            components: result.components,
            navigations: result.navigations,
            dummyMain: result.dummyMain,
            duration: {
                sceneBuilding: result.duration.sceneBuilding,
                lifecycleModeling: result.duration.lifecycleModeling,
                navigationAnalysis: result.duration.navigationAnalysis,
            },
        };
        const content = JSON.stringify(report, null, 2);
        if (outputPath) {
            const resolved = path.resolve(outputPath);
            fs.mkdirSync(path.dirname(resolved), { recursive: true });
            fs.writeFileSync(resolved, content, 'utf8');
        }
        return content;
    }
}
