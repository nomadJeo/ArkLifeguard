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

    it('runs the default resource-analysis CLI pipeline and emits JSON results', async () => {
        const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const code = await runCLI([
            'node',
            'arklifeguard',
            'analyze',
            fixturePath('resource', 'source-sink'),
            '--sdk',
            fixturePath('sdk'),
            '--no-nullness',
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
        output.mockRestore();
    });
});
