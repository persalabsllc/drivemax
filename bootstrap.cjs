const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const projectRoot = process.cwd();
const marker = path.join(projectRoot, 'app', 'layout.tsx');
if (fs.existsSync(marker)) process.exit(0);

const sourceDir = path.join(projectRoot, '.source');
const parts = fs
  .readdirSync(sourceDir)
  .filter((name) => /^part-\d+\.b64$/.test(name))
  .sort();

if (!parts.length) {
  throw new Error('Drive Max source archive parts are missing.');
}

const encoded = parts
  .map((name) => fs.readFileSync(path.join(sourceDir, name), 'utf8').trim())
  .join('');
const archiveBytes = Buffer.from(encoded, 'base64');
const digest = crypto.createHash('sha256').update(archiveBytes).digest('hex');
const expected = '98b5bf297c249181574570f6f87bc14eb2439bfdde39b94a3b7b634bf8835e06';

if (digest !== expected) {
  throw new Error('Drive Max source archive failed its integrity check.');
}

const archivePath = path.join(os.tmpdir(), 'drivemax-source.tgz');
fs.writeFileSync(archivePath, archiveBytes);
execFileSync('tar', ['-xzf', archivePath, '-C', projectRoot], { stdio: 'inherit' });
fs.rmSync(archivePath, { force: true });
console.log('Drive Max website source restored.');
