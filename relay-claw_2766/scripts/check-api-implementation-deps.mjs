// @ts-check
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const FORBIDDEN = [
  '@office-claw/green-package',
  '@office-claw/green-package-runtime',
  '@openjiuwen/relay-storage-sqlite',
];

const DEP_KEYS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

const pkgPath = resolve(rootDir, 'packages', 'api', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const violations = [];
for (const key of DEP_KEYS) {
  const deps = pkg[key] || {};
  for (const forbidden of FORBIDDEN) {
    if (deps[forbidden]) {
      violations.push(`packages/api/package.json "${key}" 中禁止依赖 "${forbidden}"`);
    }
  }
}

if (violations.length > 0) {
  console.error('--- 架构违规：api-server 不得依赖 contracts 协议的实现包 ---');
  for (const v of violations) console.error(`  ERROR: ${v}`);
  console.error('这些包应通过环境变量驱动的动态 import() 加载，而非声明为依赖。');
  process.exit(1);
}

console.log('ok: api-server 的 package.json 中没有直接依赖实现包');
