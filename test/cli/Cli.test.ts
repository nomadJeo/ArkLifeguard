import { describe, expect, it, vi } from 'vitest';
import { runCLI } from '../../src/cli';
import { fixturePath } from '../helpers/buildScene';

describe('ArkLifeguard CLI', () => {
    it('prints its version and exits successfully', async () => {
        const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        expect(await runCLI(['node', 'arklifeguard', 'version'])).toBe(0);
        expect(output).toHaveBeenCalledWith('arklifeguard v0.1.0');
        output.mockRestore();
    });

    it('rejects an invalid fact propagation depth before analysis', async () => {
        expect(await runCLI([
            'node',
            'arklifeguard',
            'analyze',
            '/not/analyzed',
            '--max-propagation-depth',
            '0',
        ])).toBe(1);
    });

    it('selects only resource analysis and emits compact JSON results', async () => {
        const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const code = await runCLI([
            'node',
            'arklifeguard',
            'analyze',
            fixturePath('resource', 'source-sink'),
            '--sdk',
            fixturePath('sdk'),
            '--checks',
            'resource',
            '--format',
            'json',
        ]);

        expect(code).toBe(0);
        const json = output.mock.calls.map(call => call.join(' '))
            .find(value => value.startsWith('{'));
        expect(json).toBeDefined();
        expect(JSON.parse(json ?? '{}').resourceAnalysis).toMatchObject({
            enabled: true,
            success: true,
        });
        expect(JSON.parse(json ?? '{}').nullness).toMatchObject({ enabled: false });
        output.mockRestore();
    });

    it('runs both core checks by default', async () => {
        const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const code = await runCLI([
            'node',
            'arklifeguard',
            'analyze',
            fixturePath('resource', 'source-sink'),
            '--sdk',
            fixturePath('sdk'),
            '--format',
            'json',
        ]);

        expect(code).toBe(0);
        const json = output.mock.calls.map(call => call.join(' '))
            .find(value => value.startsWith('{'));
        const report = JSON.parse(json ?? '{}');
        expect(report.nullness.enabled).toBe(true);
        expect(report.resourceAnalysis.enabled).toBe(true);
        output.mockRestore();
    });

    it('rejects an unknown check name', async () => {
        expect(await runCLI([
            'node',
            'arklifeguard',
            'analyze',
            '/not/analyzed',
            '--checks',
            'nullness,unknown',
        ])).toBe(1);
    });
});
