/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, '..', '..', '..');
const buildScript = readFileSync(join(repoRoot, 'scripts', 'build-macos-installer.mjs'), 'utf8');
const startScript = readFileSync(join(repoRoot, 'scripts', 'start-macos.sh'), 'utf8');
const staticServer = readFileSync(join(repoRoot, 'packages', 'web', 'scripts', 'packaged-static-server.cjs'), 'utf8');

test('macOS web runtime stages the static frontend server with API media proxy support', () => {
  assert.ok(buildScript.includes("const WEB_STATIC_SERVER_SOURCE = join(repoRoot, 'packages', 'web', 'scripts', 'packaged-static-server.cjs');"));
  assert.ok(buildScript.includes("const GREEN_PACKAGE_WEB_DIST_DIR = join(repoRoot, 'packages', 'green-package', 'web', 'dist');"));
  assert.ok(buildScript.includes("const targetDir = join(targetRootDir, 'packages', 'green-package', 'web');"));
  assert.ok(buildScript.includes("cpSync(GREEN_PACKAGE_WEB_DIST_DIR, join(targetDir, 'dist')"));
  assert.ok(buildScript.includes("copyFileSync(WEB_STATIC_SERVER_SOURCE, join(targetDir, 'server.cjs'))"));
  assert.ok(startScript.includes('WEB_SERVER="$PROJECT_ROOT/packages/green-package/web/server.cjs"'));
  assert.ok(staticServer.includes("req.url.startsWith('/api') || req.url.startsWith('/uploads')"));
});

test('macOS runtime package layout mirrors Windows green-package workspace layout', () => {
  for (const packageDir of [
    "'shared'",
    "'core'",
    "join('plugin', 'api')",
    "join('green-package', 'api')",
    "join('green-package', 'web')",
    "join('storage-sqlite', 'api')",
    "'api'",
    "'mcp-server'",
  ]) {
    assert.ok(buildScript.includes(packageDir), `${packageDir} should be in the macOS runtime package layout`);
  }
  assert.ok(buildScript.includes("'@office-claw/green-package': 'file:../green-package/api'"));
  assert.ok(buildScript.includes("'@openjiuwen/relay-storage-sqlite': 'file:../storage-sqlite/api'"));
});

test('macOS runtime includes catalog builder required by install-auth-config', () => {
  assert.ok(buildScript.includes("'build-catalog.mjs'"));
  assert.ok(buildScript.includes("'install-auth-config.mjs'"));
});

test('macOS bundled API runtime provides the cli entry expected by start-macos', () => {
  assert.ok(startScript.includes('API_DIST="$PROJECT_ROOT/packages/api/dist/cli.js"'));
  assert.ok(buildScript.includes("scripts: { start: 'node dist/cli.js' }"));
  assert.ok(buildScript.includes("join(distDir, 'cli.js')"));
  assert.ok(buildScript.includes("import { main } from './index.js';"));
});

test('macOS cleanup tolerates exiting before managed child processes are registered', () => {
  assert.ok(startScript.includes('if [ "${#MANAGED_PIDS[@]}" -gt 0 ]; then'));
});

test('macOS bundled startup defaults to the same login-required auth provider as Windows', () => {
  assert.match(startScript, /export OFFICE_CLAW_AUTH_PROVIDER="\$\{OFFICE_CLAW_AUTH_PROVIDER:-huawei-cas\}"/);
  assert.match(
    startScript,
    /export OFFICE_CLAW_AUTH_PROVIDER_MODULES="\$\{OFFICE_CLAW_AUTH_PROVIDER_MODULES:-@office-claw\/green-package\/providers-plugin\}"/,
  );
  assert.match(startScript, /export OFFICE_CLAW_SKIP_AUTH="\$\{OFFICE_CLAW_SKIP_AUTH:-0\}"/);
});

test('macOS runtime pruning preserves inspiration product markdown assets', () => {
  assert.ok(buildScript.includes('function shouldPruneRuntimeFile'));
  assert.ok(buildScript.includes("packageName === 'api' ? [join('assets', 'inspiration', 'products')] : []"));
});

test('macOS API runtime staging resets stale files and uses the same markdown product whitelist', () => {
  const stageApiBlock = buildScript.slice(
    buildScript.indexOf('async function stageBundledApiRuntime'),
    buildScript.indexOf('function createStandaloneWebRuntimePackageJson'),
  );
  const installRuntimeBlock = buildScript.slice(
    buildScript.indexOf('function installMacosRuntimeDependencies'),
    buildScript.indexOf('function minifyJsFilesInPlace'),
  );

  assert.match(stageApiBlock, /resetDir\(targetDir\)/);
  assert.match(stageApiBlock, /cpSync\(assetSourceDir, join\(targetDir, 'assets'\)/);
  assert.match(
    installRuntimeBlock,
    /pruneRuntimePackage\(join\(pkgDir\), \{\s*preserveMarkdownUnder:\s*packageName === 'api' \? \[join\('assets', 'inspiration', 'products'\)\] : \[\],?\s*\}\)/s,
  );
});

test('macOS vendor staging excludes generated logs and packaging metadata', () => {
  assert.ok(buildScript.includes("'logs',"));
  assert.ok(buildScript.includes("const excludeFiles = new Set(['uv.lock', 'PKG-INFO', 'METADATA']);"));
});

test('macOS API runtime externalizes native packages that esbuild cannot bundle', () => {
  for (const dependency of ['cross-keychain', 'snappy', '@napi-rs/keyring']) {
    assert.ok(buildScript.includes(`'${dependency}'`), `${dependency} should be listed as a runtime external`);
  }
  assert.ok(buildScript.includes('SNAPPY_NATIVE_PACKAGE'));
  assert.ok(buildScript.includes('KEYRING_NATIVE_PACKAGE'));
});

test('macOS runtime npm install skips Puppeteer browser postinstall like Windows packaging', () => {
  assert.ok(buildScript.includes("PUPPETEER_SKIP_DOWNLOAD: '1'"));
  assert.ok(buildScript.includes("run('npm', npmArgs, { cwd: pkgDir, env: npmEnv })"));
});

test('macOS Redis staging resets target dir before resolving system redis', () => {
  assert.ok(buildScript.includes("const targetDir = join(bundleDir, 'tools', 'redis', 'bin');\n  resetDir(targetDir);"));
});

test('macOS runtime dependency pruning includes date-fns locale pruning helper', () => {
  assert.ok(buildScript.includes('function pruneDateFnsLocales'));
  assert.ok(buildScript.includes("const keepPrefixes = ['en-US', 'zh-CN', '_lib', 'types', 'cdn'];"));
});

test('macOS Playwright browser install preserves process environment', () => {
  assert.ok(buildScript.includes("run('npx', ['playwright', 'install', 'chromium']"));
  assert.ok(buildScript.includes('...process.env,\n        PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath'));
});

test('macOS app assembly dereferences symlinks for a self-contained app bundle', () => {
  assert.ok(buildScript.includes("run(python.path, ['-m', 'venv', '--copies', targetDir])"));
  assert.ok(buildScript.includes('function copyExecutableFile(source, destination)'));
  assert.ok(buildScript.includes("copyExecutableFile(systemRedis, join(targetDir, 'redis-server'))"));
  assert.ok(buildScript.includes("const EXCLUDED_TOP_LEVEL_SEGMENTS = new Set(['.git', 'node_modules', '.venv', '.build-venv', 'venv', '__pycache__'])"));
  assert.ok(buildScript.includes('function normalizeBundleSymlinks(rootDir)'));
  assert.ok(buildScript.includes('normalizeBundleSymlinks(bundleDir)'));
  assert.ok(buildScript.includes("run('ditto', [bundleDir, resourcesDir])"));
});
