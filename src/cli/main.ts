#!/usr/bin/env node

import { runCLI } from './cli';

void runCLI().then(code => {
    process.exitCode = code;
}).catch(error => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
});
