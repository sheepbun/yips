#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');

const isWin = os.platform() === 'win32';
const ext = isWin ? '.exe' : '';
const binPath = path.join(__dirname, `yips${ext}`);

const result = spawnSync(binPath, process.argv.slice(2), { 
    stdio: 'inherit',
    env: { ...process.env, YIPS_NPM_INSTALL: '1' }
});
if (result.error) {
    console.error(`Failed to execute Yips binary at ${binPath}:`, result.error.message);
    process.exit(1);
}
process.exit(result.status || 0);
