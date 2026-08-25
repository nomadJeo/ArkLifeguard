import { describe, expect, it, vi } from 'vitest';
import { runCLI } from '../../src/cli';

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
});
