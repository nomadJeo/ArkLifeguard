#!/usr/bin/env -S npx vite-node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type SdkVersion = string | number | null;

interface InputProject {
    repo: string;
}

interface InputMetadata {
    projects: InputProject[];
}

interface ProjectMetadata {
    name: string;
    path: string;
    repo: string;
    revision: string;
    resolvedCommit: string;
    compileSdkVersion: SdkVersion;
    compatibleSdkVersion: SdkVersion;
    targetSdkVersion: SdkVersion;
}

interface FailedProjectMetadata {
    repo: string;
    error: string;
}

type OutputProject = ProjectMetadata | FailedProjectMetadata;

interface Options {
    metaPath: string;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, '..');
const defaultMetaPath = path.join(repositoryRoot, 'HarmonyRealApps/meta.json');

function printHelp(): void {
    console.log([
        'Usage:',
        '  npm run sync:real-apps',
        '  npm run sync:real-apps -- --meta <meta.json>',
        '',
        'Only repo is an input field. For each entry, this command:',
        '  1. derives name and path;',
        '  2. clones a missing repository without updating an existing checkout;',
        '  3. records the current branch and full commit;',
        '  4. extracts SDK versions from build-profile.json5;',
        '  5. rewrites meta.json atomically.',
    ].join('\n'));
}

function parseArgs(args: string[]): Options {
    let metaPath = defaultMetaPath;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '-h' || arg === '--help') {
            printHelp();
            process.exit(0);
        }
        if (arg === '--meta') {
            const value = args[index + 1];
            if (!value || value.startsWith('-')) throw new Error('--meta requires a file path');
            metaPath = path.resolve(value);
            index++;
            continue;
        }
        if (arg.startsWith('--meta=')) {
            metaPath = path.resolve(arg.slice('--meta='.length));
            continue;
        }
        throw new Error(`Unknown option: ${arg}`);
    }
    return { metaPath };
}

function readInput(metaPath: string): InputMetadata {
    if (!fs.existsSync(metaPath) || !fs.statSync(metaPath).isFile()) {
        throw new Error(`Metadata file does not exist: ${metaPath}`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (error) {
        throw new Error(`Invalid JSON in ${metaPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as InputMetadata).projects)) {
        throw new Error(`Expected an object with a projects array in ${metaPath}`);
    }
    const projects = (parsed as InputMetadata).projects.map((project, index) => {
        if (!project || typeof project !== 'object' || typeof project.repo !== 'string' || !project.repo.trim()) {
            throw new Error(`projects[${index}].repo must be a non-empty string`);
        }
        return { repo: project.repo.trim() };
    });
    return { projects };
}

function deriveName(repo: string): string {
    try {
        const url = new URL(repo);
        const segments = url.pathname.split('/').filter(Boolean);
        if (['github.com', 'gitee.com', 'gitcode.com'].includes(url.hostname.toLowerCase()) &&
            ['tree', 'blob'].includes(segments[2])) {
            const repositoryUrl = `${url.protocol}//${url.host}/${segments[0]}/${segments[1].replace(/\.git$/i, '')}.git`;
            throw new Error(`Repository URL contains a web page path; use ${repositoryUrl}`);
        }
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('Repository URL contains')) throw error;
    }
    const withoutQuery = repo.split(/[?#]/, 1)[0].replace(/[\\/]+$/, '');
    const separator = Math.max(withoutQuery.lastIndexOf('/'), withoutQuery.lastIndexOf(':'));
    const encodedName = withoutQuery.slice(separator + 1).replace(/\.git$/i, '');
    let name: string;
    try {
        name = decodeURIComponent(encodedName);
    } catch {
        name = encodedName;
    }
    if (!name || name === '.' || name === '..' || !/^[A-Za-z0-9._-]+$/.test(name)) {
        throw new Error(`Cannot derive a safe project name from repository URL: ${repo}`);
    }
    return name;
}

function runGit(
    args: string[],
    cwd: string,
    options: { timeout?: number; env?: NodeJS.ProcessEnv } = {}
): string {
    try {
        return execFileSync('git', args, {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: options.timeout,
            env: options.env ?? process.env,
        }).trim();
    } catch (error) {
        const details = error as { stderr?: string | Buffer; message?: string };
        const stderr = details.stderr?.toString().trim();
        throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${stderr || details.message || 'unknown error'}`);
    }
}

function runGitOptional(args: string[], cwd: string): string | undefined {
    try {
        return execFileSync('git', args, {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        }).trim() || undefined;
    } catch {
        return undefined;
    }
}

function normalizeRepo(repo: string): string {
    const value = repo.trim().replace(/[\\/]+$/, '').replace(/\.git$/i, '');
    if (value.includes('://')) {
        try {
            const url = new URL(value);
            return `${url.hostname.toLowerCase()}/${url.pathname.replace(/^\//, '')}`;
        } catch {
            return value;
        }
    }
    const scp = value.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
    if (scp && !/^[A-Za-z]:[\\/]/.test(value)) {
        return `${scp[1].toLowerCase()}/${scp[2].replace(/^\//, '')}`;
    }
    return path.resolve(value);
}

function sshAlternative(repo: string): string | undefined {
    try {
        const url = new URL(repo);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
        if (!['github.com', 'gitee.com', 'gitcode.com'].includes(url.hostname.toLowerCase())) return undefined;
        const repositoryPath = url.pathname.replace(/^\//, '').replace(/\.git$/i, '');
        if (!repositoryPath) return undefined;
        return `git@${url.hostname}:${repositoryPath}.git`;
    } catch {
        return undefined;
    }
}

function conciseFailure(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const lines = message.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const important = lines.filter(line => /^(fatal:|error:|ssh:|remote:)/i.test(line));
    return (important.at(-1) ?? lines.at(-1) ?? message).slice(0, 500);
}

function portableError(message: string): string {
    return message
        .split(repositoryRoot).join('<repository-root>')
        .replace(/\.clone-\d+/g, '.clone');
}

function cloneRepository(repo: string, projectPath: string): void {
    const temporaryPath = `${projectPath}.clone-${process.pid}`;
    if (fs.existsSync(temporaryPath)) {
        throw new Error(`Temporary clone path already exists: ${temporaryPath}`);
    }
    const candidates = [repo];
    const sshRepo = sshAlternative(repo);
    if (sshRepo && normalizeRepo(sshRepo) === normalizeRepo(repo)) candidates.push(sshRepo);
    const failures: string[] = [];

    for (const candidate of candidates) {
        try {
            console.log(`Cloning ${candidate} -> ${projectPath}`);
            const sshEnvironment = candidate.startsWith('git@')
                ? { ...process.env, GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=20' }
                : process.env;
            runGit(['clone', '--', candidate, temporaryPath], repositoryRoot, {
                timeout: 120_000,
                env: sshEnvironment,
            });
            fs.renameSync(temporaryPath, projectPath);
            return;
        } catch (error) {
            failures.push(`${candidate}: ${conciseFailure(error)}`);
            if (fs.existsSync(temporaryPath)) {
                fs.rmSync(temporaryPath, { recursive: true, force: true });
            }
        }
    }
    throw new Error(`All clone attempts failed:\n${failures.join('\n')}`);
}

function ensureCheckout(repo: string, projectPath: string): void {
    if (!fs.existsSync(projectPath)) {
        fs.mkdirSync(path.dirname(projectPath), { recursive: true });
        cloneRepository(repo, projectPath);
    }
    if (!fs.statSync(projectPath).isDirectory()) {
        throw new Error(`Project path is not a directory: ${projectPath}`);
    }

    const gitRoot = path.resolve(runGit(['rev-parse', '--show-toplevel'], projectPath));
    const realGitRoot = fs.realpathSync(gitRoot);
    const realProjectPath = fs.realpathSync(projectPath);
    if (realGitRoot !== realProjectPath) {
        throw new Error(
            `${projectPath} is not an independent Git checkout; git resolves to ${gitRoot}. ` +
            'Remove the directory and rerun, or clone the intended repository there.'
        );
    }

    const origin = runGit(['remote', 'get-url', 'origin'], projectPath);
    if (normalizeRepo(origin) !== normalizeRepo(repo)) {
        throw new Error(`Repository mismatch at ${projectPath}: meta has ${repo}, origin is ${origin}`);
    }
    const dirty = runGit(['status', '--porcelain'], projectPath);
    if (dirty) {
        throw new Error(`${projectPath} has uncommitted changes; commit or clean them before syncing metadata`);
    }
}

function extractVersion(text: string, key: string): SdkVersion {
    const pattern = new RegExp(
        `^\\s*["']?${key}["']?\\s*:\\s*(?:"([^"]*)"|'([^']*)'|(-?\\d+(?:\\.\\d+)?))`,
        'gm'
    );
    const values: Array<string | number> = [];
    for (const match of text.matchAll(pattern)) {
        const raw = match[1] ?? match[2];
        const value = raw !== undefined ? raw : Number(match[3]);
        const identity = versionIdentity(value);
        const existingIndex = values.findIndex(existing => versionIdentity(existing) === identity);
        if (existingIndex < 0) {
            values.push(value);
        } else if (isRicherVersion(value, values[existingIndex])) {
            values[existingIndex] = value;
        }
    }
    if (values.length > 1) {
        throw new Error(`Multiple ${key} values found: ${values.join(', ')}`);
    }
    return values[0] ?? null;
}

function versionIdentity(value: string | number): string {
    if (typeof value === 'number') return `api:${value}`;
    const apiMatch = value.match(/\((\d+)\)$/);
    if (apiMatch) return `api:${Number(apiMatch[1])}`;
    if (/^\d+$/.test(value)) return `api:${Number(value)}`;
    return `version:${value}`;
}

function isRicherVersion(candidate: string | number, current: string | number): boolean {
    return typeof candidate === 'string' && /\(\d+\)$/.test(candidate) &&
        !(typeof current === 'string' && /\(\d+\)$/.test(current));
}

function readSdkVersions(projectPath: string): Pick<
    ProjectMetadata,
    'compileSdkVersion' | 'compatibleSdkVersion' | 'targetSdkVersion'
> {
    const profilePath = path.join(projectPath, 'build-profile.json5');
    if (!fs.existsSync(profilePath) || !fs.statSync(profilePath).isFile()) {
        console.warn(`Warning: build-profile.json5 not found in ${projectPath}; SDK fields will be null`);
        return { compileSdkVersion: null, compatibleSdkVersion: null, targetSdkVersion: null };
    }
    const text = fs.readFileSync(profilePath, 'utf8');
    return {
        compileSdkVersion: extractVersion(text, 'compileSdkVersion'),
        compatibleSdkVersion: extractVersion(text, 'compatibleSdkVersion'),
        targetSdkVersion: extractVersion(text, 'targetSdkVersion'),
    };
}

function inspectProject(repo: string, projectsRoot: string, metaDir: string): ProjectMetadata {
    const name = deriveName(repo);
    const projectPath = path.join(projectsRoot, name);
    ensureCheckout(repo, projectPath);
    const resolvedCommit = runGit(['rev-parse', 'HEAD'], projectPath);
    const revision = runGitOptional(['symbolic-ref', '--short', '-q', 'HEAD'], projectPath) ?? resolvedCommit;
    return {
        name,
        path: path.relative(metaDir, projectPath).split(path.sep).join('/'),
        repo,
        revision,
        resolvedCommit,
        ...readSdkVersions(projectPath),
    };
}

function writeMetadata(metaPath: string, metadata: { projects: OutputProject[] }): void {
    const temporaryPath = path.join(
        path.dirname(metaPath),
        `.${path.basename(metaPath)}.${process.pid}.tmp`
    );
    fs.writeFileSync(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, metaPath);
}

function main(): void {
    const { metaPath } = parseArgs(process.argv.slice(2));
    const input = readInput(metaPath);
    const metaDir = path.dirname(metaPath);
    const projectsRoot = path.join(metaDir, 'projects');
    const names = new Set<string>();
    const repositories = new Set<string>();
    const projects: OutputProject[] = [];
    const failures: FailedProjectMetadata[] = [];
    input.projects.forEach(({ repo }, index) => {
        try {
            const name = deriveName(repo);
            const normalizedRepo = normalizeRepo(repo);
            if (names.has(name)) throw new Error(`Duplicate derived project name: ${name}`);
            if (repositories.has(normalizedRepo)) throw new Error(`Duplicate repository: ${repo}`);
            names.add(name);
            repositories.add(normalizedRepo);
            const project = inspectProject(repo, projectsRoot, metaDir);
            console.log(`Inspected ${project.name} @ ${project.resolvedCommit.slice(0, 12)}`);
            projects.push(project);
        } catch (error) {
            const message = portableError(error instanceof Error ? error.message : String(error));
            const failed = { repo, error: message };
            failures.push(failed);
            projects.push(failed);
            console.error(`Failed projects[${index}] ${repo}: ${message}`);
        }
    });
    writeMetadata(metaPath, { projects });
    console.log(`Updated ${metaPath}`);
    console.log(`Summary: ${projects.length - failures.length} succeeded, ${failures.length} failed`);
    if (failures.length > 0) process.exitCode = 1;
}

try {
    main();
} catch (error) {
    console.error(`sync-harmony-real-apps: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
}
