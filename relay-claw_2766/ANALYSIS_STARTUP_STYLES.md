# 启动页面样式问题分析

## 问题概述

两个项目启动后的加载页样式异常：
1. **packages（无登录模式）** - 启动加载页样式不对（vs 解耦前）
2. **green-package（登录模式）** - 启动加载页样式不对

## 问题详细分析

### 问题1: packages无登录模式

#### 当前架构
```
packages/web/
├── src/app/
│   ├── layout.tsx (根layout) ✅ 有providers: ThemeRootSync, ConfirmProvider, ToastContainer
│   ├── globals.css ✅ 导入
│   └── (main)/
│       ├── layout.tsx: 只有MainShell（已删除AppAuthBootstrap）
│       └── page.tsx: ChatEmptyState（主应用页面）
```

#### 启动流程
- 访问 http://localhost:3003
- 匹配 (main)/page.tsx
- 显示 ChatEmptyState

#### 根本原因
**缺少页面内容和初始化**
- 原来: packages/web/src/app/page.tsx → redirect('/login') → 登录页
- 现在: 直接显示 (main)/page.tsx（主应用），但：
  - (main)/layout.tsx 已删除 AppAuthBootstrap
  - 没有显式的 page-level 初始化
  - 主应用页面期望 auth session 已初始化，否则 API 调用失败 → 页面卡在加载状态
  
**样式问题表现**
- 根 layout 的 providers 存在 ✓
- 但因为 API 调用失败，页面可能显示加载中状态或部分渲染

#### 解决方案
**选项A**（推荐）: 添加 root page.tsx 作为启动页
- 删除 (main) route group 的 root 匹配
- 在 src/app/page.tsx 中放置启动页面或重定向逻辑
  ```typescript
  // packages/web/src/app/page.tsx
  'use client';
  
  import { useEffect } from 'react';
  import { useRouter } from 'next/navigation';
  import { useChatStore } from '@/stores/chatStore';
  
  export default function HomePage() {
    const router = useRouter();
    const threads = useChatStore((s) => s.threads);
    
    useEffect(() => {
      // 自动跳转到主应用或首个线程
      if (threads.length > 0) {
        router.replace(`/thread/${threads[0].id}`);
      } else {
        router.replace('/channels');
      }
    }, [threads, router]);
    
    return <div className="flex items-center justify-center h-screen">加载中...</div>;
  }
  ```

**选项B**: 保持 (main)/page.tsx，但在 (main)/layout.tsx 中补充初始化
- (main)/layout.tsx 中添加 auth 检查和初始化逻辑

---

### 问题2: green-package登录模式

#### 当前架构
```
packages/green-package/web/
├── src/app/
│   ├── layout.tsx (根layout) ❌ 过于简洁：只有html/body，无providers
│   ├── globals.css ✓ 存在
│   ├── page.tsx: redirect('/login')
│   └── login/
│       ├── page.tsx: 登录表单（'use client'）
│       ├── callback/page.tsx: CAS 回调
│       └── invitation/page.tsx: 邀请码处理
```

#### 启动流程
- 访问 http://localhost:3003/login
- 显示 login/page.tsx（登录表单）

#### 根本原因
**根 layout 缺少必要的 providers 和样式初始化**

green-package/web/src/app/layout.tsx 现状：
```typescript
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>    // ❌ body 没有 className，无样式容器
    </html>
  );
}
```

packages/web/src/app/layout.tsx 对比（参考）：
```typescript
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-ui-theme={DEFAULT_THEME} suppressHydrationWarning>
      <body className="h-screen h-dvh w-full overflow-hidden" suppressHydrationWarning>
        {/* providers... */}
      </body>
    </html>
  );
}
```

**问题表现**
- CSS 样式（globals.css 中的 Tailwind/全局样式）加载了，但：
  - body 没有容器类名 → 高度/宽度/overflow 样式未应用 → 登录页加载异常
  - 缺少 Theme bootstrap script → 主题切换不工作
  - 缺少 Providers（如果登录页有客户端逻辑需要 Context）

#### 解决方案
**补全 green-package/web/src/app/layout.tsx 的 providers**

```typescript
import type { Metadata } from 'next';
import Script from 'next/script';
import { buildThemeBootstrapScript, DEFAULT_THEME } from '@/utils/theme-persistence';
import { ConfirmProvider } from '@/components/useConfirm';
import { ToastContainer } from '@/components/ToastContainer';
import './globals.css';

export const metadata: Metadata = {
  title: 'OfficeClaw Login',
  description: 'OfficeClaw login web package',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-ui-theme={DEFAULT_THEME} suppressHydrationWarning>
      <body className="h-screen h-dvh w-full overflow-hidden" suppressHydrationWarning>
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {buildThemeBootstrapScript()}
        </Script>
        <ConfirmProvider>
          {children}
        </ConfirmProvider>
        <ToastContainer />
      </body>
    </html>
  );
}
```

---

## 修复优先级

### 高优先级
1. **green-package layout** - 添加 providers 和样式容器（5 分钟）
   - 立即修复样式混乱问题
   - 文件: `packages/green-package/web/src/app/layout.tsx`

### 中优先级
2. **packages root page** - 添加启动页逻辑（10 分钟）
   - 确保无登录启动时有合理的首页
   - 文件: 新增 `packages/web/src/app/page.tsx`
   - 考虑用 route group 的 page.tsx 还是 root page.tsx

---

## 验证步骤

### 修复后验证 green-package
```bash
pnpm --dir packages/green-package run start:direct -- --quick --memory
# 期望: 登录页显示完整，样式正常，无加载异常
```

### 修复后验证 packages
```bash
pnpm start:direct -- --quick --memory
# 期望: 首页显示完整，可导航到主应用，样式正常
```

---

## 相关代码位置

- [packages/web/src/app/layout.tsx](packages/web/src/app/layout.tsx) - 完整参考
- [packages/green-package/web/src/app/layout.tsx](packages/green-package/web/src/app/layout.tsx) - 需修复
- [packages/green-package/web/src/app/login/page.tsx](packages/green-package/web/src/app/login/page.tsx) - 登录页
- [packages/web/src/app/(main)/page.tsx](packages/web/src/app/(main)/page.tsx) - 主应用入口
