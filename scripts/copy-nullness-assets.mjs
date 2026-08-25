import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const source = path.join(
    repoRoot,
    'src/analysis/nullness/library/sdk-nullness-summary.json'
);
const targetDirectory = path.join(repoRoot, 'dist/analysis/nullness/library');

fs.mkdirSync(targetDirectory, { recursive: true });
fs.copyFileSync(source, path.join(targetDirectory, path.basename(source)));
