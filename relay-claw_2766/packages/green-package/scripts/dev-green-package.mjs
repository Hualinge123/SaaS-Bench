import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const packageRoot = resolve(__dirname, '..');
  const rawArgs = process.argv.slice(2);
  const allowedTargets = new Set(['dev', 'dev:all', 'dev:b', 'dev:backend', 'dev:f', 'dev:frontend']);
  const authAliases = new Map([
    ['cas', 'huawei-cas'],
    ['huawei-cas', 'huawei-cas'],
    ['oauth', 'huawei-oauth'],
    ['oauth2', 'huawei-oauth'],
    ['huawei-oauth', 'huawei-oauth'],
  ]);
  const requestedTarget = allowedTargets.has(rawArgs[0]) ? rawArgs[0] : 'dev';
  const authArg = rawArgs.find((arg) => authAliases.has(arg));
  const selectedAuthProvider = authAliases.get(authArg) ?? 'huawei-cas';
  const isOauthDev = authArg && selectedAuthProvider === 'huawei-oauth';
  const mockFrontendBase = process.env.MOCK_FRONTEND_BASE || `http://127.0.0.1:${process.env.FRONTEND_PORT || '3003'}`;
  const effectiveAuthProvider = authArg ? selectedAuthProvider : process.env.OFFICE_CLAW_AUTH_PROVIDER || selectedAuthProvider;
  const effectiveForceAuthProvider = authArg
    ? selectedAuthProvider
    : process.env.OFFICE_CLAW_FORCE_AUTH_PROVIDER || effectiveAuthProvider;
  const targetScript = requestedTarget === 'dev' ? 'dev:all' : requestedTarget;

  const unknownArgs = rawArgs.filter((arg) => !allowedTargets.has(arg) && !authAliases.has(arg));
  if (unknownArgs.length > 0) {
    console.error(`Unsupported green-package dev argument(s): ${unknownArgs.join(', ')}`);
    console.error('Usage: pnpm --dir packages/green-package dev [cas|oauth]');
    console.error('       pnpm --dir packages/green-package dev:b [cas|oauth]');
    console.error('       pnpm --dir packages/green-package dev:f [cas|oauth]');
    process.exit(1);
  }

  function findWorkspaceRoot(startDir) {
    let current = startDir;
    while (true) {
      const packageJsonPath = resolve(current, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
          if (pkg.scripts?.['dev:all']) return current;
        } catch {
          // ignore malformed package.json
        }
      }
      const parent = resolve(current, '..');
      if (parent === current) break;
      current = parent;
    }
    return null;
  }

  const workspaceRoot = findWorkspaceRoot(packageRoot);
  const useWorkspaceRoot = Boolean(workspaceRoot);

  function buildApiPackage() {
    const apiDir = resolve(packageRoot, 'api');
    const apiPackageJsonPath = resolve(apiDir, 'package.json');
    if (!fs.existsSync(apiPackageJsonPath)) return;

    const apiPkg = JSON.parse(fs.readFileSync(apiPackageJsonPath, 'utf8'));
    if (!apiPkg.scripts?.build) return;

    const buildArgs = pnpmExecPath ? [pnpmExecPath, '--dir', apiDir, 'build'] : ['--dir', apiDir, 'build'];
    console.log('[green-package] Building api package before dev...');
    runCommandSync(buildArgs, packageRoot);
  }

  function clearGeneratedDevCache() {
    const paths = [
      resolve(packageRoot, 'api', 'dist'),
      resolve(packageRoot, 'web', 'dist'),
      resolve(packageRoot, 'web', 'node_modules', '.vite'),
      resolve(packageRoot, 'node_modules', '.vite'),
    ];
    for (const path of paths) {
      fs.rmSync(path, { recursive: true, force: true });
    }
    console.log('[green-package] Cleared generated dev cache.');
  }

  const env = {
    ...process.env,
    OFFICE_CLAW_FORCE_AUTH_PROVIDER: effectiveForceAuthProvider,
    OFFICE_CLAW_AUTH_PROVIDER: effectiveAuthProvider,
    OFFICE_CLAW_AUTH_PROVIDER_MODULES:
      process.env.OFFICE_CLAW_AUTH_PROVIDER_MODULES || '@office-claw/green-package/providers-plugin',
    OFFICE_CLAW_STORAGE_PROVIDER_MODULES:
      process.env.OFFICE_CLAW_STORAGE_PROVIDER_MODULES || '@openjiuwen/relay-storage-sqlite',
    OFFICE_CLAW_APPROVAL_RECORD_PROVIDER:
      process.env.OFFICE_CLAW_APPROVAL_RECORD_PROVIDER || 'sqlite-approval-records',
    OFFICE_CLAW_SKIP_AUTH: process.env.OFFICE_CLAW_SKIP_AUTH || '0',
    CAT_CAFE_SKIP_AUTH: process.env.CAT_CAFE_SKIP_AUTH || '0',
    OFFICE_CLAW_SCHEDULER_PROVIDER: process.env.OFFICE_CLAW_SCHEDULER_PROVIDER || 'sqlite',
    OFFICE_CLAW_SCHEDULER_PROVIDER_MODULES:
      process.env.OFFICE_CLAW_SCHEDULER_PROVIDER_MODULES || '@openjiuwen/relay-storage-sqlite/scheduler',
    OFFICE_CLAW_EVIDENCE_PROVIDER: process.env.OFFICE_CLAW_EVIDENCE_PROVIDER || 'sqlite',
    OFFICE_CLAW_EVIDENCE_PROVIDER_MODULES:
      process.env.OFFICE_CLAW_EVIDENCE_PROVIDER_MODULES || '@openjiuwen/relay-storage-sqlite/evidence',
    ...(isOauthDev
      ? {
          OAUTH_MOCK: '1',
          MOCK_FRONTEND_BASE: mockFrontendBase,
          OAUTH_REDIRECT_URI: `${mockFrontendBase}/login/auth-test`,
        }
      : {}),
  };

  const pnpmExecPath = process.env.npm_execpath;
  const command = pnpmExecPath ? process.execPath : process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

  clearGeneratedDevCache();
  console.log(`[green-package] Auth provider: ${env.OFFICE_CLAW_AUTH_PROVIDER}`);
  if (env.OFFICE_CLAW_AUTH_PROVIDER === 'huawei-oauth') {
    console.log(`[green-package] OAuth redirect_uri: ${env.OAUTH_REDIRECT_URI || '(provider default)'}`);
  }

  function spawnProcess(args, cwd) {
    return spawn(command, args, {
      cwd,
      env,
      stdio: 'inherit',
      windowsHide: false,
    });
  }

  function runCommandSync(args, cwd) {
    const result = spawnSync(command, args, {
      cwd,
      env,
      stdio: 'inherit',
      windowsHide: false,
    });
    if (result.error) {
      console.error(result.error);
      process.exit(1);
    }
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }

  function exitWithError(message) {
    console.error(message);
    process.exit(1);
  }

  function runSingle(args, cwd) {
    const child = spawnProcess(args, cwd);
    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code ?? 1);
    });
    child.on('error', (error) => {
      console.error(error);
      process.exit(1);
    });
  }

  function runConcurrent(children) {
    let exitCount = 0;
    children.forEach((child) => {
      child.on('exit', (code, signal) => {
        exitCount += 1;
        if (signal) {
          process.kill(process.pid, signal);
          return;
        }
        if (exitCount === children.length) {
          process.exit(code ?? 1);
        }
      });
      child.on('error', (error) => {
        console.error(error);
        process.exit(1);
      });
    });
  }

  if (useWorkspaceRoot) {
    if (requestedTarget !== 'dev:f') {
      buildApiPackage();
    }
    env.OFFICE_CLAW_WEB_APP_DIR = process.env.OFFICE_CLAW_WEB_APP_DIR || (workspaceRoot === packageRoot ? 'web' : 'packages/green-package/web');
    const args = pnpmExecPath
      ? [pnpmExecPath, '--dir', workspaceRoot, targetScript]
      : ['--dir', workspaceRoot, targetScript];
    runSingle(args, workspaceRoot);
  } else {
    const webDir = resolve(packageRoot, 'web');
    const apiDir = resolve(packageRoot, 'api');
    const webPackageJsonPath = resolve(webDir, 'package.json');
    const apiPackageJsonPath = resolve(apiDir, 'package.json');
    const hasWeb = fs.existsSync(webPackageJsonPath);
    const hasApi = fs.existsSync(apiPackageJsonPath);

    if (!hasWeb) {
      exitWithError('无法找到 green-package 本地 web 包，请确认 `web/package.json` 是否存在。');
    }

    const webArgs = pnpmExecPath
      ? [pnpmExecPath, '--dir', webDir, 'dev']
      : ['--dir', webDir, 'dev'];

    if (targetScript === 'dev' || targetScript === 'dev:f') {
      if (targetScript !== 'dev:f' && hasApi) {
        buildApiPackage();
      }
      runSingle(webArgs, packageRoot);
      return;
    }

    if (targetScript === 'dev:b' || targetScript === 'dev:backend') {
      if (!hasApi) {
        exitWithError('独立模式下无法启动 backend：找不到 `api/package.json`。');
      }
      buildApiPackage();
      const apiPkg = JSON.parse(fs.readFileSync(apiPackageJsonPath, 'utf8'));
      if (!apiPkg.scripts?.dev) {
        exitWithError('独立模式下 `api/package.json` 缺少 `dev` 脚本，无法启动 backend。');
      }
      const args = pnpmExecPath
        ? [pnpmExecPath, '--dir', apiDir, 'dev']
        : ['--dir', apiDir, 'dev'];
      runSingle(args, packageRoot);
      return;
    }

    if (targetScript === 'dev:all') {
      if (hasApi) {
        buildApiPackage();
      }
      const children = [spawnProcess(webArgs, packageRoot)];
      if (hasApi) {
        const apiPkg = JSON.parse(fs.readFileSync(apiPackageJsonPath, 'utf8'));
        if (apiPkg.scripts?.dev) {
          const apiArgs = pnpmExecPath
            ? [pnpmExecPath, '--dir', apiDir, 'dev']
            : ['--dir', apiDir, 'dev'];
          children.push(spawnProcess(apiArgs, packageRoot));
        }
      }
      runConcurrent(children);
      return;
    }

    exitWithError(`Unsupported target in standalone mode: ${requestedTarget}`);
  }
}

main();
