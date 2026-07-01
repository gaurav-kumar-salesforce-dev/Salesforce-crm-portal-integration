const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const BUILD_HASH_FILES = [
  'app.js',
  'style.css',
  'client-performance.js',
  'session.js',
  'production-readiness.js',
  'production-readiness.css',
  'greeting.js',
  'greeting.css',
  'reports.js',
  'reports.css',
  'dashboards.js',
  'admin.html',
  'index.html'
];

function computeBuildHash(publicDir = PUBLIC_DIR) {
  const hash = crypto.createHash('sha256');
  BUILD_HASH_FILES.forEach((file) => {
    const filePath = path.join(publicDir, file);
    if (!fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    hash.update(file);
    hash.update(String(stat.mtimeMs));
    hash.update(String(stat.size));
  });
  return hash.digest('hex').slice(0, 12);
}

const BUILD_HASH = process.env.BUILD_HASH || computeBuildHash(PUBLIC_DIR);

module.exports = {
  ROOT_DIR,
  PUBLIC_DIR,
  BUILD_HASH,
  BUILD_HASH_FILES,
  JSON_BODY_LIMIT: process.env.JSON_BODY_LIMIT || '25mb'
};
