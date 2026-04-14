const fs = require('fs');
const https = require('https');
const path = require('path');
const os = require('os');

const isWin = os.platform() === 'win32';
const ext = isWin ? '.exe' : '';
const binaryName = isWin ? 'yips-core-windows.exe' : 'yips-core-linux';
const initialUrl = `https://github.com/sheepbun/yips/releases/latest/download/${binaryName}`;
const binDir = path.join(__dirname, 'bin');

if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir);
}

const dest = path.join(binDir, `yips${ext}`);

console.log(`Downloading Yips binary from ${initialUrl}...`);

function download(url) {
    https.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
            // Follow redirect
            if (res.headers.location) {
                download(res.headers.location);
            } else {
                console.error(`Redirect without location header (status ${res.statusCode})`);
                process.exit(1);
            }
        } else if (res.statusCode === 200) {
            const file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                if (!isWin) {
                    fs.chmodSync(dest, 0o755);
                }
                console.log('Downloaded Yips binary successfully.');
            });
        } else {
            console.error(`Failed to download: HTTP ${res.statusCode}`);
            process.exit(1);
        }
    }).on('error', handleError);
}

download(initialUrl);

function handleError(err) {
    console.error('Error downloading Yips:', err.message);
    process.exit(1);
}
