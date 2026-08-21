import path from 'node:path';
import type { Sdk } from 'arkanalyzer/lib/Config';
import { Scene, SceneConfig } from 'arkanalyzer';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');
const SDK_DIR = path.join(FIXTURES_DIR, 'sdk');

const sdk: Sdk = {
    name: 'test-sdk',
    path: SDK_DIR,
    moduleName: '',
};

export function fixturePath(...segments: string[]): string {
    return path.join(FIXTURES_DIR, ...segments);
}

export function buildLifecycleScene(projectName: string): Scene {
    const projectPath = fixturePath('lifecycle', projectName);
    const config = new SceneConfig();
    config.buildConfig(projectPath, projectPath, [sdk]);
    config.buildFromProjectDir(projectPath);

    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}
