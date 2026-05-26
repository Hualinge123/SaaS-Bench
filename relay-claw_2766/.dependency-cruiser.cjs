// @ts-check
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'api-server-no-implementation-imports-resolved',
      severity: 'error',
      comment:
        'api-server 禁止导入 contracts 协议的实现包（green-package、storage-sqlite）的源码或产物。' +
        '请通过环境变量驱动的动态 import() 加载实现，而非直接 import。',
      from: { path: '^packages/api/' },
      to: { path: 'packages/(green-package|storage-sqlite)/' },
    },
    {
      name: 'api-server-no-implementation-imports-unresolved',
      severity: 'error',
      comment:
        'api-server 禁止引用 contracts 协议的实现包的模块名。' +
        '不要写 import from "@office-claw/green-package" 或 "@openjiuwen/relay-storage-sqlite"。',
      from: { path: '^packages/api/' },
      to: {
        path: '^@office-claw/green-package|^@openjiuwen/relay-storage-sqlite',
        couldNotResolve: true,
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    moduleSystems: ['es6', 'cjs', 'tsd'],
    tsPreCompilationDeps: true,
    exoticRequireStrings: ['import'],
  },
};
