'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const popupJs = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const popupCss = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');

assert.equal(manifest.manifest_version, 3);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'storage']);
assert.equal('host_permissions' in manifest, false);

const referencedFiles = [
  manifest.action.default_popup,
  manifest.background.service_worker,
  ...manifest.content_scripts.flatMap((entry) => entry.js)
];
for (const file of referencedFiles) {
  assert.equal(fs.existsSync(path.join(root, file)), true, `缺少 manifest 引用文件：${file}`);
}

const requiredIds = [...popupJs.matchAll(/getElementById\('([^']+)'\)/g)].map((match) => match[1]);
for (const id of requiredIds) {
  assert.match(popupHtml, new RegExp(`id=["']${id}["']`), `popup.html 缺少 #${id}`);
}

const scripts = [...popupHtml.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(scripts, ['core.js', 'popup.js']);
assert.equal(fs.existsSync(path.join(root, 'popup.css')), true, '缺少 popup.css');
assert.match(popupHtml, new RegExp(`v${manifest.version.replace(/\./g, '\\.')}`), '界面版本号与 manifest 不一致');
assert.equal((popupCss.match(/{/g) || []).length, (popupCss.match(/}/g) || []).length, 'popup.css 花括号不平衡');

process.stdout.write(`包结构检查通过：${referencedFiles.length} 个清单文件，${requiredIds.length} 个 popup 元素。\n`);
