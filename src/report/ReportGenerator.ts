/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ProjectAnalysisResult } from '../application';

export type ReportFormat = 'json' | 'text' | 'html' | 'markdown';

export interface ReportOptions {
    format: ReportFormat;
    outputPath?: string;
    detailed?: boolean;
    title?: string;
}

/** Serializes the public application result without depending on solver internals. */
export class ReportGenerator {
    generate(result: ProjectAnalysisResult, options: ReportOptions): string {
        const content = this.render(result, options);
        if (options.outputPath) {
            const outputPath = path.resolve(options.outputPath);
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, content, 'utf8');
        }
        return content;
    }

    private render(result: ProjectAnalysisResult, options: ReportOptions): string {
        switch (options.format) {
            case 'json': return JSON.stringify(options.detailed ? result : this.compactJson(result), null, 2);
            case 'text': return this.text(result, options);
            case 'markdown': return this.markdown(result, options);
            case 'html': return this.html(result, options);
        }
    }

    private compactJson(result: ProjectAnalysisResult): object {
        return {
            schemaVersion: result.schemaVersion,
            analysisKind: result.analysisKind,
            status: result.status,
            project: result.project,
            summary: {
                nullDereferences: result.summary.nullDereferences,
                resourceLeaks: result.summary.resourceLeaks,
                methodLocalResourceLeaks: result.resourceAnalysis.methodLocal.leaks.length,
            },
            nullness: {
                enabled: result.nullness.enabled,
                success: result.nullness.success,
                diagnostics: result.nullness.diagnostics,
            },
            resourceAnalysis: {
                enabled: result.resourceAnalysis.enabled,
                success: result.resourceAnalysis.success,
                resourceLeaks: result.resourceAnalysis.resourceLeaks,
                methodLocal: {
                    leaks: result.resourceAnalysis.methodLocal.leaks,
                },
            },
            duration: { total: result.duration.total },
            warnings: result.warnings,
            errors: result.errors,
        };
    }

    private text(result: ProjectAnalysisResult, options: ReportOptions): string {
        const title = options.title ?? 'ArkLifeguard HarmonyOS 静态分析报告';
        const lines = [
            '='.repeat(72),
            title,
            '='.repeat(72),
            `项目: ${result.project.name}`,
            `路径: ${result.project.path}`,
            `状态: ${result.status}`,
            `时间: ${result.project.analyzedAt}`,
            '',
            '【总体结果】',
            `  空指针报告: ${result.nullness.enabled ? result.summary.nullDereferences : '未启用'}`,
            `  跨过程资源泄漏报告: ${result.resourceAnalysis.enabled ? result.summary.resourceLeaks : '未启用'}`,
            `  方法内资源候选: ${result.resourceAnalysis.methodLocal.leaks.length}`,
        ];
        if (options.detailed) this.appendTextInternals(lines, result);
        lines.push('', '【资源泄漏诊断】');
        if (!result.resourceAnalysis.enabled) {
            lines.push('  未启用资源泄漏分析。');
        } else if (result.resourceAnalysis.resourceLeaks.length === 0) {
            lines.push('  未检出资源泄漏候选问题。');
        } else {
            result.resourceAnalysis.resourceLeaks.forEach((leak, index) => {
                lines.push(`  ${index + 1}. ${leak.description}`);
                lines.push(`     类型: ${leak.resourceType}`);
                lines.push(`     位置: ${this.locationText(leak.source)}`);
                lines.push(`     期望释放: ${leak.expectedSink}`);
            });
        }
        lines.push('', '【方法内资源泄漏诊断】');
        if (!result.resourceAnalysis.enabled) {
            lines.push('  未启用资源泄漏分析。');
        } else if (result.resourceAnalysis.methodLocal.leaks.length === 0) {
            lines.push('  未检出方法内资源泄漏候选问题。');
        } else {
            result.resourceAnalysis.methodLocal.leaks.forEach((leak, index) => {
                lines.push(`  ${index + 1}. [${leak.severity}] ${leak.description}`);
                lines.push(`     位置: ${leak.filePath}:${leak.lineNumber}`);
                lines.push(`     期望释放: ${leak.expectedSink}`);
            });
        }
        lines.push('', '【空指针诊断】');
        if (!result.nullness.enabled) {
            lines.push('  未启用空指针分析。');
        } else if (result.nullness.diagnostics.length === 0) {
            lines.push('  未检出空指针候选问题。');
        } else {
            result.nullness.diagnostics.forEach((diagnostic, index) => {
                lines.push(`  ${index + 1}. [${diagnostic.confidence}] ${diagnostic.description}`);
                lines.push(`     位置: ${this.locationText(diagnostic.dereference)}`);
                lines.push(`     来源: ${this.locationText(diagnostic.source)}`);
                lines.push(`     访问路径: ${diagnostic.accessPath} (${diagnostic.nullness})`);
            });
        }
        if (options.detailed) this.appendTextDetails(lines, result);
        lines.push('', '【耗时】');
        if (options.detailed) {
            lines.push(`  Scene: ${result.duration.sceneBuilding}ms`);
            lines.push(`  生命周期: ${result.duration.lifecycleModeling}ms`);
            lines.push(`  导航: ${result.duration.navigationAnalysis}ms`);
            lines.push(`  空指针: ${result.duration.nullnessAnalysis}ms`);
            lines.push(`  资源分析: ${result.duration.resourceAnalysis}ms`);
        }
        lines.push(`  总耗时: ${result.duration.total}ms`);
        this.appendMessages(lines, result);
        return lines.join('\n');
    }

    private markdown(result: ProjectAnalysisResult, options: ReportOptions): string {
        const title = options.title ?? 'ArkLifeguard HarmonyOS 静态分析报告';
        const lines = [
            `# ${title}`,
            '',
            `- 项目：\`${result.project.name}\``,
            `- 状态：\`${result.status}\``,
            `- 分析时间：${result.project.analyzedAt}`,
            '',
            '## 结果摘要',
            '',
            '| 指标 | 数值 |',
            '|---|---:|',
            `| 空指针报告 | ${result.nullness.enabled ? result.summary.nullDereferences : '未启用'} |`,
            `| 跨过程资源泄漏报告 | ${result.resourceAnalysis.enabled ? result.summary.resourceLeaks : '未启用'} |`,
            `| 方法内资源候选 | ${result.resourceAnalysis.methodLocal.leaks.length} |`,
            `| 总耗时(ms) | ${result.duration.total} |`,
        ];
        if (options.detailed) this.appendMarkdownInternals(lines, result);
        lines.push('', '## 资源泄漏诊断', '');
        if (!result.resourceAnalysis.enabled) {
            lines.push('未启用资源泄漏分析。');
        } else if (result.resourceAnalysis.resourceLeaks.length === 0) {
            lines.push('未检出资源泄漏候选问题。');
        } else {
            for (const leak of result.resourceAnalysis.resourceLeaks) {
                lines.push(`- **${leak.resourceType}** ${leak.description}`);
                lines.push(`  - 位置：\`${this.locationText(leak.source)}\``);
                lines.push(`  - 期望释放：\`${leak.expectedSink}\``);
            }
        }
        lines.push('', '## 方法内资源泄漏诊断', '');
        if (!result.resourceAnalysis.enabled) {
            lines.push('未启用资源泄漏分析。');
        } else if (result.resourceAnalysis.methodLocal.leaks.length === 0) {
            lines.push('未检出方法内资源泄漏候选问题。');
        } else {
            for (const leak of result.resourceAnalysis.methodLocal.leaks) {
                lines.push(`- **${leak.severity} / ${leak.resourceType}** ${leak.description}`);
                lines.push(`  - 位置：\`${leak.filePath}:${leak.lineNumber}\``);
                lines.push(`  - 期望释放：\`${leak.expectedSink}\``);
            }
        }
        lines.push('', '## 空指针诊断', '');
        if (!result.nullness.enabled) {
            lines.push('未启用空指针分析。');
        } else if (result.nullness.diagnostics.length === 0) {
            lines.push('未检出空指针候选问题。');
        } else {
            for (const diagnostic of result.nullness.diagnostics) {
                lines.push(`- **${diagnostic.confidence}** ${diagnostic.description}`);
                lines.push(`  - 位置：\`${this.locationText(diagnostic.dereference)}\``);
                lines.push(`  - 来源：\`${this.locationText(diagnostic.source)}\``);
                lines.push(`  - 访问路径：\`${diagnostic.accessPath}\``);
            }
        }
        if (options.detailed) {
            lines.push('', '## Ability', '');
            for (const ability of result.abilities) {
                lines.push(`- ${ability.name}${ability.isEntry ? ' (入口)' : ''}: ${ability.lifecycleMethods.join(', ')}`);
            }
            lines.push('', '## Component', '');
            for (const component of result.components) {
                lines.push(`- ${component.name}: ${component.uiCallbacks.length} 个 UI 回调`);
            }
        }
        return lines.join('\n');
    }

    private html(result: ProjectAnalysisResult, options: ReportOptions): string {
        const title = this.escape(options.title ?? 'ArkLifeguard HarmonyOS 静态分析报告');
        const summary: Array<[string, string | number]> = [
            ['空指针报告', result.nullness.enabled ? result.summary.nullDereferences : '未启用'],
            ['跨过程资源泄漏报告', result.resourceAnalysis.enabled ? result.summary.resourceLeaks : '未启用'],
            ['方法内资源候选', result.resourceAnalysis.methodLocal.leaks.length],
            ['总耗时(ms)', result.duration.total],
        ];
        if (options.detailed) {
            summary.push(
                ['工程文件', result.summary.projectFiles],
                ['类', result.summary.classes],
                ['方法', result.summary.methods],
                ['Ability', result.summary.abilities],
                ['Component', result.summary.components],
                ['UI 回调', result.summary.uiCallbacks],
                ['导航关系', result.summary.navigations],
                ['通用污点报告', result.summary.taintLeaks],
                ['Source', result.summary.sources],
                ['Sink', result.summary.sinks],
            );
        }
        const summaryRows = summary
            .map(([name, value]) => `<tr><th>${name}</th><td>${value}</td></tr>`).join('');
        const b = result.settings.bounds;
        const boundRows = Object.entries(b)
            .map(([name, value]) => `<tr><th>${this.escape(name)}</th><td>${value}</td><td>${this.escape(result.settings.boundEnforcement[name as keyof typeof b])}</td></tr>`).join('');
        const diagnostics = !result.nullness.enabled
            ? '<p>未启用空指针分析。</p>'
            : result.nullness.diagnostics.length === 0
            ? '<p>未检出空指针候选问题。</p>'
            : `<ol>${result.nullness.diagnostics.map(diagnostic => `<li>
                <strong>${diagnostic.confidence}</strong> ${this.escape(diagnostic.description)}
                <div><code>${this.escape(this.locationText(diagnostic.dereference))}</code></div>
                <div>访问路径: <code>${this.escape(diagnostic.accessPath)}</code></div>
            </li>`).join('')}</ol>`;
        const resourceLeaks = !result.resourceAnalysis.enabled
            ? '<p>未启用资源泄漏分析。</p>'
            : result.resourceAnalysis.resourceLeaks.length === 0
            ? '<p>未检出资源泄漏候选问题。</p>'
            : `<ol>${result.resourceAnalysis.resourceLeaks.map(leak => `<li>
                <strong>${this.escape(leak.resourceType)}</strong> ${this.escape(leak.description)}
                <div><code>${this.escape(this.locationText(leak.source))}</code></div>
                <div>期望释放: <code>${this.escape(leak.expectedSink)}</code></div>
            </li>`).join('')}</ol>`;
        const methodLocalLeaks = !result.resourceAnalysis.enabled
            ? '<p>未启用资源泄漏分析。</p>'
            : result.resourceAnalysis.methodLocal.leaks.length === 0
            ? '<p>未检出方法内资源泄漏候选问题。</p>'
            : `<ol>${result.resourceAnalysis.methodLocal.leaks.map(leak => `<li>
                <strong>${this.escape(leak.severity)} / ${this.escape(leak.resourceType)}</strong>
                ${this.escape(leak.description)}
                <div><code>${this.escape(`${leak.filePath}:${leak.lineNumber}`)}</code></div>
                <div>期望释放: <code>${this.escape(leak.expectedSink)}</code></div>
            </li>`).join('')}</ol>`;
        const internals = options.detailed ? `
<h2>有界分析配置</h2><table><tr><th>参数</th><th>数值</th><th>状态</th></tr>${boundRows}</table>
<h2>DummyMain</h2><p><code>${this.escape(result.dummyMain.methodSignature)}</code></p>` : '';
        return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:14px/1.6 system-ui,sans-serif;max-width:1100px;margin:32px auto;padding:0 20px;color:#202124}h1,h2{color:#16324f}table{border-collapse:collapse;width:100%;margin:12px 0 24px}th,td{border:1px solid #ccd3da;padding:8px;text-align:left}th{background:#f3f6f8}code{background:#f3f6f8;padding:2px 5px}.failed{color:#b42318}.success{color:#067647}</style>
</head><body><h1>${title}</h1>
<p>项目: <code>${this.escape(result.project.path)}</code></p>
<p>状态: <strong class="${result.status}">${result.status}</strong></p>
<h2>结果摘要</h2><table>${summaryRows}</table>${internals}
<h2>资源泄漏诊断</h2>${resourceLeaks}
<h2>方法内资源泄漏诊断</h2>${methodLocalLeaks}
<h2>空指针诊断</h2>${diagnostics}
</body></html>`;
    }

    private appendTextInternals(lines: string[], result: ProjectAnalysisResult): void {
        const bounds = result.settings.bounds;
        lines.push(
            '',
            '【分析内部信息】',
            `  工程文件: ${result.summary.projectFiles}`,
            `  类 / 方法: ${result.summary.classes} / ${result.summary.methods}`,
            `  Ability / Component: ${result.summary.abilities} / ${result.summary.components}`,
            `  生命周期方法: ${result.summary.lifecycleMethods}`,
            `  UI 回调 / 导航关系: ${result.summary.uiCallbacks} / ${result.summary.navigations}`,
            `  Source / Sink: ${result.summary.sources} / ${result.summary.sinks}`,
            `  到达语句 / Fact: ${result.summary.reachedStatements} / ${result.summary.reachedFacts}`,
            `  DummyMain: ${result.dummyMain.methodSignature}`,
            `  DummyMain 基本块 / 语句: ${result.dummyMain.blocks} / ${result.dummyMain.statements}`,
            `  生命周期调用 / UI 回调: ${result.dummyMain.lifecycleCalls} / ${result.dummyMain.uiCallbackCalls}`,
            `  生命周期展开次数: ${bounds.maxCallbackIterations}`,
            `  Ability 数量上限: ${bounds.maxAbilitiesPerFlow} (${result.settings.boundEnforcement.maxAbilitiesPerFlow})`,
            `  导航跳数上限: ${bounds.maxNavigationHops} (${result.settings.boundEnforcement.maxNavigationHops})`,
            `  访问路径长度上限: ${bounds.maxAccessPathLength}`,
            `  Fact 传播深度上限: ${bounds.maxPropagationDepth}`,
        );
    }

    private appendMarkdownInternals(lines: string[], result: ProjectAnalysisResult): void {
        const bounds = result.settings.bounds;
        lines.push(
            '',
            '## 分析内部信息',
            '',
            '| 指标 | 数值 |',
            '|---|---:|',
            `| 工程文件 | ${result.summary.projectFiles} |`,
            `| 类 | ${result.summary.classes} |`,
            `| 方法 | ${result.summary.methods} |`,
            `| Ability | ${result.summary.abilities} |`,
            `| Component | ${result.summary.components} |`,
            `| UI 回调 | ${result.summary.uiCallbacks} |`,
            `| 导航关系 | ${result.summary.navigations} |`,
            `| Source | ${result.summary.sources} |`,
            `| Sink | ${result.summary.sinks} |`,
            '',
            '| 有界参数 | 数值 | 状态 |',
            '|---|---:|---|',
            `| maxCallbackIterations | ${bounds.maxCallbackIterations} | enforced |`,
            `| maxAbilitiesPerFlow | ${bounds.maxAbilitiesPerFlow} | ${result.settings.boundEnforcement.maxAbilitiesPerFlow} |`,
            `| maxNavigationHops | ${bounds.maxNavigationHops} | ${result.settings.boundEnforcement.maxNavigationHops} |`,
            `| maxAccessPathLength | ${bounds.maxAccessPathLength} | enforced |`,
            `| maxPropagationDepth | ${bounds.maxPropagationDepth} | enforced |`,
        );
    }

    private appendTextDetails(lines: string[], result: ProjectAnalysisResult): void {
        lines.push('', '【Ability】');
        for (const ability of result.abilities) {
            lines.push(`  ${ability.name}${ability.isEntry ? ' [入口]' : ''}: ${ability.lifecycleMethods.join(', ')}`);
        }
        lines.push('', '【Component】');
        for (const component of result.components) {
            lines.push(`  ${component.name}: ${component.uiCallbacks.length} 个 UI 回调`);
        }
        lines.push('', '【导航关系】');
        for (const navigation of result.navigations) {
            lines.push(`  ${navigation.source} -> ${navigation.target} (${navigation.type}, ${navigation.method})`);
        }
    }

    private appendMessages(lines: string[], result: ProjectAnalysisResult): void {
        if (result.warnings.length > 0) {
            lines.push('', '【警告】', ...result.warnings.map(value => `  ${value}`));
        }
        if (result.errors.length > 0) {
            lines.push('', '【错误】', ...result.errors.map(value => `  ${value}`));
        }
    }

    private locationText(location: { relativePath: string; line: number; col: number }): string {
        return `${location.relativePath}:${location.line}:${location.col}`;
    }

    private escape(value: unknown): string {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }
}
