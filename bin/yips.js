#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');

const isWin = os.platform() === 'win32';
const ext = isWin ? '.exe' : '';
const binPath = path.join(__dirname, `yips${ext}`);

const result = spawnSync(binPath, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
    console.error(`Failed to execute Yips binary at ${binPath}:`, result.error.message);
    process.exit(1);
}
process.exit(result.status || 0);
