/**
 * Dump the ArkIR generated for ArkTS null-safety syntax.
 *
 * Run from the ArkLifeguard root:
 *   npm run test:nullness:ir
 */
import fs from 'fs';
import path from 'path';
import { describe, it } from 'vitest';
import { Scene, SceneConfig } from '../../src/adapter/arkanalyzer';
import { Sdk } from '../../src/adapter/arkanalyzer';

const BENCH_ROOT = path.join(__dirname, '../../ArkDefectBench');
const BASIC_NULL_ROOT = path.join(BENCH_ROOT, 'Null Pointer Dereference/BasicNull');
const SDK_DIR = path.join(__dirname, '../fixtures/sdk');
const sdk: Sdk = { name: '', path: SDK_DIR, moduleName: '' };

function dumpCase(casePath: string): string {
    const projectPath = path.join(BASIC_NULL_ROOT, casePath);
    const config = new SceneConfig();
    config.buildConfig(projectPath, projectPath, [sdk]);
    config.buildFromProjectDir(projectPath);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();

    const lines: string[] = [`## ${casePath}`];
    for (const arkClass of scene.getClasses()) {
        for (const method of arkClass.getMethods()) {
            const cfg = method.getCfg();
            if (!cfg) continue;
            lines.push(`### ${arkClass.getName()}.${method.getName()}`);
            for (const block of cfg.getBlocks()) {
                for (const stmt of block.getStmts()) {
                    lines.push(`- ${stmt.toString()}`);
                }
            }
        }
    }
    return lines.join('\n');
}

describe('ArkTS null-safety ArkIR dump', () => {
    it('prints BasicNull cases and writes a reproducible artifact', () => {
        const cases = fs.readdirSync(BASIC_NULL_ROOT, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .sort();
        const output = cases.map(dumpCase).join('\n\n');
        const outputPath = path.join(__dirname, '../../out/arkts-null-safety-ir.txt');
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, `${output}\n`, 'utf8');
        console.log(`ArkTS null-safety IR written to ${outputPath}`);
        console.log(output);
    });
});
