import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectAnalysisResult } from '../../src/application';
import { ReportGenerator } from '../../src/report';

const result: ProjectAnalysisResult = {
    schemaVersion: 1,
    analysisKind: 'lifecycle-nullness',
    status: 'success',
    project: { path: '/project', name: 'project', analyzedAt: '2026-08-24T00:00:00.000Z' },
    settings: {
        sdkPaths: ['/sdk/openharmony/ets'],
        inferTypes: true,
        extractUICallbacks: true,
        analyzeNavigation: true,
        runNullness: true,
        bounds: {
            maxCallbackIterations: 1,
            maxAbilitiesPerFlow: 3,
            maxNavigationHops: 5,
            maxAccessPathLength: 5,
            maxPropagationDepth: 40,
        },
        boundEnforcement: {
            maxCallbackIterations: 'enforced',
            maxAbilitiesPerFlow: 'inactive-without-resource-analysis',
            maxNavigationHops: 'inactive-without-resource-analysis',
            maxAccessPathLength: 'enforced',
            maxPropagationDepth: 'enforced',
        },
        reportUnresolvedReturns: false,
    },
    summary: {
        projectFiles: 3,
        sceneFiles: 5,
        classes: 2,
        methods: 8,
        abilities: 1,
        components: 1,
        lifecycleMethods: 4,
        uiCallbacks: 1,
        navigations: 1,
        nullDereferences: 1,
        reachedStatements: 10,
        reachedFacts: 12,
    },
    abilities: [{
        name: 'EntryAbility', className: 'EntryAbility', isEntry: true,
        lifecycleMethods: ['onCreate'], filePath: '/project/EntryAbility.ets',
    }],
    components: [{
        name: 'Index', className: 'Index', isEntry: true,
        lifecycleMethods: ['build'],
        uiCallbacks: [{ eventType: 'onClick', methodName: 'click', componentType: 'Button' }],
        filePath: '/project/Index.ets',
    }],
    navigations: [{ source: 'EntryAbility', target: 'pages/Index', type: 'loadContent', method: 'onWindowStageCreate' }],
    dummyMain: {
        methodSignature: 'DummyMain.main()', blocks: 4, statements: 9,
        lifecycleCalls: 2, uiCallbackCalls: 1,
    },
    nullness: {
        enabled: true,
        success: true,
        entryMethod: 'DummyMain.main()',
        diagnostics: [{
            nullness: 'Null',
            accessPath: 'value',
            description: 'Definite null dereference',
            confidence: 'high',
            source: { filePath: '/project/Index.ets', relativePath: 'Index.ets', line: 10, col: 5 },
            dereference: { filePath: '/project/Index.ets', relativePath: 'Index.ets', line: 12, col: 7 },
        }],
        reachedStatements: 10,
        reachedFacts: 12,
    },
    duration: {
        sceneBuilding: 100,
        lifecycleModeling: 20,
        navigationAnalysis: 5,
        nullnessAnalysis: 30,
        total: 155,
    },
    warnings: [],
    errors: [],
};

describe('ReportGenerator', () => {
    it.each(['json', 'text', 'markdown', 'html'] as const)('generates %s reports', format => {
        const report = new ReportGenerator().generate(result, { format, detailed: true });
        expect(report).toContain('project');
        expect(report).toContain(format === 'json' ? 'maxPropagationDepth' : '40');
    });

    it('writes the report to the requested path', () => {
        const outputPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'arklifeguard-report-')), 'report.json');
        new ReportGenerator().generate(result, { format: 'json', outputPath });
        expect(JSON.parse(fs.readFileSync(outputPath, 'utf8')).analysisKind)
            .toBe('lifecycle-nullness');
    });
});
