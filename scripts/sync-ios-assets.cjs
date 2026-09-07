const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'ios-web');
const assets = [
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icon.svg',
  'service-worker.js',
];

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });

for (const asset of assets) {
  fs.copyFileSync(path.join(root, asset), path.join(destination, asset));
}

console.log(`Synced ${assets.length} web assets for iOS.`);
