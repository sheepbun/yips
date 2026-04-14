const fs = require('fs');
const https = require('https');
const path = require('path');
const os = require('os');

const isWin = os.platform() === 'win32';
const ext = isWin ? '.exe' : '';
const binaryName = isWin ? 'yips-windows.exe' : 'yips-linux';
const url = `https://github.com/sheepbun/yips/releases/latest/download/${binaryName}`;
const binDir = path.join(__dirname, 'bin');

if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir);
}

const dest = path.join(binDir, `yips${ext}`);

console.log(`Downloading Yips binary from ${url}...`);

https.get(url, (res) => {
    if (res.statusCode === 301 || res.statusCode === 302) {
        // Follow redirect
        https.get(res.headers.location, (redirectRes) => {
            downloadStream(redirectRes);
        }).on('error', handleError);
    } else {
        downloadStream(res);
    }
}).on('error', handleError);

function downloadStream(res) {
    if (res.statusCode !== 200) {
        console.error(`Failed to download: HTTP ${res.statusCode}`);
        process.exit(1);
    }
    const file = fs.createWriteStream(dest);
    res.pipe(file);
    file.on('finish', () => {
        file.close();
        if (!isWin) {
            fs.chmodSync(dest, 0o755);
        }
        console.log('Downloaded Yips binary successfully.');
    });
}

function handleError(err) {
    console.error('Error downloading Yips:', err.message);
    process.exit(1);
}
