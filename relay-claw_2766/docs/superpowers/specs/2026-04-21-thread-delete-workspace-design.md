# 删除会话时可选删除工作目录（方案二：共享目录不可删）

## 背景

当前删除会话只会软删除线程记录，不会删除 `projectPath` 对应的工作目录。

这会带来两个实际诉求：

1. 用户希望在删除单个会话时，顺手清理掉该会话独占的工作目录。
2. 用户又可能让多个会话复用同一个工作目录，此时删除其中一个会话不应该连带删掉共享目录。

之前的最小方案允许用户在共享场景下继续删除目录，只做风险提示。但这会导致两个问题：

1. 前端提示和实际后果都过于危险，容易误删其他会话仍在使用的目录。
2. 共享目录在运行中可能存在文件占用，实际删除结果不稳定，用户感知也不一致。

因此本设计改为更保守的方案二：

1. 非共享目录可以随会话一起删除。
2. 共享目录在前端直接提示“不可删除”。
3. 后端也保留兜底保护，即使收到旧客户端的删除请求，也不会删除共享目录。

## 目标

1. 删除会话弹窗展示当前工作目录路径。
2. 删除会话弹窗展示该目录是否被其他会话共享。
3. 非共享目录允许勾选“同时删除工作目录”。
4. 共享目录禁止勾选“同时删除工作目录”。
5. 后端审计日志准确记录“请求了删除目录，但因共享而跳过”。

## 非目标

1. 不区分“系统自动创建目录”和“用户手动选择目录”。
2. 不做工作目录回收站或恢复能力。
3. 不新增独立的“工作目录检查”接口。
4. 不解决所有目录占用、权限不足等外部系统问题。

## 用户体验

### 删除弹窗

删除会话时弹窗展示：

1. 会话删除不可恢复提示。
2. 当前 `projectPath`。
3. 共享状态说明。
4. “同时删除工作目录”复选框。

### 非共享目录文案

```text
该工作目录当前未发现其他会话共享。
```

复选框可点击，默认不勾选。

### 共享目录文案

```text
该工作目录当前被 N 个其他会话共享，不能在删除会话时一并删除。
共享工作目录不可在这里删除，请先处理其他会话后再手动清理该目录。
```

复选框禁用且保持未勾选。

## 前端设计

文件：`packages/web/src/components/ThreadSidebar/ThreadSidebar.tsx`

### 共享判断

前端直接基于已加载的 `threads` 与 `trashedThreads` 计算共享情况：

```ts
const relatedThreads = [...threads, ...trashedThreads];
const sharedCount = relatedThreads.filter(
  (thread) =>
    thread.id !== deleteTarget.id &&
    thread.projectPath &&
    deleteTarget.projectPath &&
    thread.projectPath === deleteTarget.projectPath,
).length;
```

### 交互规则

1. `sharedCount === 0` 时，复选框可用。
2. `sharedCount > 0` 时，复选框禁用。
3. 一旦目标线程变为共享状态，前端自动清空 `deleteWorkspace` 勾选状态。
4. 提交删除时，仅当 `deleteWorkspace === true && sharedCount === 0` 才带 `?deleteWorkspace=true`。

## 后端设计

文件：`packages/api/src/routes/threads.ts`

### 请求格式

```http
DELETE /api/threads/:id
DELETE /api/threads/:id?deleteWorkspace=true
```

### 删除流程

1. 解析 `deleteWorkspace`。
2. 读取线程和 `projectPath`。
3. 统计是否还有其他线程共享同一 `projectPath`。
4. 先软删除线程。
5. 如果未请求删除目录，则直接返回。
6. 如果目录被共享，则跳过目录删除，记录 `shared_workspace`。
7. 如果目录未共享，则继续执行现有目录安全检查与实际删除。
8. 无论目录是否删除成功，都不影响会话删除结果。

### 审计与响应头

保留以下结果字段：

1. `workspaceDeleteRequested`
2. `workspaceDeleteAttempted`
3. `workspaceDeleteSucceeded`
4. `workspaceDeleteSkippedReason`
5. `workspaceWasSharedAtDelete`
6. `workspaceSharedThreadCount`

当共享目录被跳过时：

```json
{
  "workspaceDeleteRequested": true,
  "workspaceDeleteAttempted": false,
  "workspaceDeleteSucceeded": false,
  "workspaceDeleteSkippedReason": "shared_workspace",
  "workspaceWasSharedAtDelete": true,
  "workspaceSharedThreadCount": 1
}
```

## 测试

### 前端

1. 非共享目录时展示路径与可用复选框。
2. 共享目录时展示“不可删除共享空间”提示。
3. 共享目录时复选框禁用，确认删除不会携带 `deleteWorkspace=true`。
4. 如果后端因并发变化返回 `shared_workspace`，前端提示“工作目录已保留”。

### 后端

1. 未请求删除目录时保留目录。
2. 请求删除非共享目录时正常删除。
3. 请求删除共享目录时保留目录并写入 `shared_workspace` 审计结果。

## 可行性与实现难度

这是一个可行性高、实现难度低的方案。

原因：

1. 不需要修改线程数据模型。
2. 不需要新增数据库字段或迁移。
3. 前端只是在现有删除弹窗上增加共享判断和禁用态。
4. 后端只是在现有删除逻辑上增加一个共享目录短路分支。
5. 测试改动范围集中，回归面可控。

综合评估：

1. 产品复杂度：低
2. 前端实现难度：低
3. 后端实现难度：低
4. 回归风险：中低

主要风险点只剩两个：

1. 前端共享判断依赖当前已加载线程列表，属于提示型能力，不保证绝对强一致。
2. 极端并发下目录状态可能在弹窗展示后发生变化，因此仍需要后端 `shared_workspace` 兜底。
