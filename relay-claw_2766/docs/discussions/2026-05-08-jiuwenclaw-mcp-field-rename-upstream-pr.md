---
feature_ids: [F140]
topics: [jiuwenclaw, vendor-patch, mcp-protocol, upstream-pr]
doc_kind: vendor-patch-record
created: 2026-05-08
author: 布偶猫/宪宪 (@opus-47)
upstream_repo: https://gitcode.com/openJiuwen/jiuwenclaw.git
upstream_branch: enterprise_dev
vendor_base_commit: 7d6062ef3fda8660c9af6712cd860a6ae7804de5
office_claw_decision_ref: docs/discussions/de-cat-merge-main-plan.md (D2)
---

# JiuwenClaw Vendor Patch — `cat_cafe_mcp` → `office_claw_mcp`

## TL;DR

OfficeClaw F140 de-cat 决定把 MCP 协议字段 `cat_cafe_mcp` 重命名为 `office_claw_mcp`（D2 决策）。前端在 commit `b0f25a91` 已经改完。**JiuwenClaw Python 后端没有同步**，导致 OfficeClaw 启动后 jiuwenclaw agent 收不到任何 OfficeClaw MCP 工具。

为了让 dev 立刻可用，本次在 OfficeClaw 这边对 `vendor/jiuwenclaw/` 内的 Python 源码做了**最小 patch**（只改协议层字段名 + 同名函数），未触动 jiuwenclaw 内部的 server prefix / ephemeral tool 命名。

**这份文档记录改动清单**，方便后续向 jiuwenclaw 上游 (`https://gitcode.com/openJiuwen/jiuwenclaw.git` `enterprise_dev`) 提同等 PR。上游合并 + release 后，这边可以撤掉 vendor patch、跑 `pnpm vendor:sync:jiuwenclaw` 拉新 vendor。

---

## Patch 范围

**未改**（vendor 内部命名，OfficeClaw 协议无关）：
- `_CAT_CAFE_SERVER_NAME_PREFIX = "cat-cafe"`（tool_manager.py L27/L39 重复定义）
- `_REQUEST_SCOPED_CAT_CAFE_SERVER_ID = "cat-cafe-request"`（L28/L40）
- `_get_cat_cafe_stdio_params()` 函数（L34）
- `self._cat_cafe_ephemeral_tools` 实例字段（L211/L398/L425/L430/L435/...）
- 函数 docstring 注释里的 "Cat Cafe MCP" 字眼
- 行内注释 `# 注册 Cat Cafe MCP（请求级环境变量）`

**改了**（协议层 + 同名函数）：

### `vendor/jiuwenclaw/jiuwenclaw/agentserver/tool_manager.py`

| 行 | 旧 | 新 |
|---|---|---|
| 361 | `async def register_request_scoped_cat_cafe_mcp(self, cfg: dict[str, Any]) -> dict[str, Any]:` | `async def register_request_scoped_office_claw_mcp(...)` |
| 364 | `raise ValueError("cat_cafe_mcp 必须是对象")` | `raise ValueError("office_claw_mcp 必须是对象")` |

### `vendor/jiuwenclaw/jiuwenclaw/agentserver/interface.py`

| 行 | 旧 | 新 |
|---|---|---|
| 729 | `cat_cafe_mcp = request.params.get("cat_cafe_mcp")` | `office_claw_mcp = request.params.get("office_claw_mcp")` |
| 730 | `if isinstance(cat_cafe_mcp, dict):` | `if isinstance(office_claw_mcp, dict):` |
| 732 | `await self._get_tool_manager().register_request_scoped_cat_cafe_mcp(cat_cafe_mcp)` | `await self._get_tool_manager().register_request_scoped_office_claw_mcp(office_claw_mcp)` |
| 734 | `logger.warning("[JiuWenClaw] cat_cafe_mcp 注册失败: %s", exc)` | `logger.warning("[JiuWenClaw] office_claw_mcp 注册失败: %s", exc)` |
| 865 | (流式版本) `cat_cafe_mcp = request.params.get("cat_cafe_mcp")` | `office_claw_mcp = request.params.get("office_claw_mcp")` |
| 866 | `if isinstance(cat_cafe_mcp, dict):` | `if isinstance(office_claw_mcp, dict):` |
| 868 | `await self._get_tool_manager().register_request_scoped_cat_cafe_mcp(cat_cafe_mcp)` | `await self._get_tool_manager().register_request_scoped_office_claw_mcp(office_claw_mcp)` |
| 870 | `logger.warning("[JiuWenClaw] cat_cafe_mcp 注册失败: %s", exc)` | `logger.warning("[JiuWenClaw] office_claw_mcp 注册失败: %s", exc)` |

总计 **11 处替换** 跨 2 个文件，函数名变更后所有调用点已同步。

---

## JiuwenClaw 上游 PR 模板

```markdown
# rename: MCP request param `cat_cafe_mcp` → `office_claw_mcp`

## Background

OfficeClaw（前 Cat Café）已完成品牌 de-cat 重构，将 MCP 协议字段从
`cat_cafe_mcp` 重命名为 `office_claw_mcp`（OfficeClaw 这边 commit
b0f25a91）。

JiuwenClaw 作为 OfficeClaw 调用的 agent server，需要同步识别新字段名，
否则 OfficeClaw 启动后 agent 拿不到任何 MCP 工具。

## Changes

最小化 patch — 只改协议层字段名 + 同名函数（保留 vendor 内部 server
prefix / ephemeral tool 命名不变）：

### `jiuwenclaw/agentserver/tool_manager.py`
- L361: `register_request_scoped_cat_cafe_mcp` → `register_request_scoped_office_claw_mcp`
- L364: error message string

### `jiuwenclaw/agentserver/interface.py`
- L729-734: non-streaming `process_message` MCP 注册块（4 处）
- L865-870: streaming `process_message_stream` MCP 注册块（4 处）

总计 11 处替换跨 2 文件。

## Backwards compatibility

⚠️ Breaking change: 旧 client 发的 `cat_cafe_mcp` 字段会被忽略。

如果需要过渡期兼容：
```python
mcp_cfg = request.params.get("office_claw_mcp") or request.params.get("cat_cafe_mcp")
```
（这种双字段兼容方案 OfficeClaw 那边也可考虑做 — 见 office-claw discussion 的选项 C）

## Testing

OfficeClaw 这边已在本地 vendor patch 验证 jiuwenclaw agent 能正常接收
OfficeClaw MCP 工具。建议 jiuwenclaw 加单元测试覆盖：
- `process_message` 路径接收 `office_claw_mcp` dict 后 `register_request_scoped_office_claw_mcp` 正常调用
- `process_message_stream` 路径同上

## Related

- OfficeClaw decision: `docs/discussions/de-cat-merge-main-plan.md` (D2)
- OfficeClaw frontend rename commit: `b0f25a91`
- OfficeClaw vendor patch (待此 PR 合并后撤掉): `office-claw repo @ vendor/jiuwenclaw/`
```

---

## OfficeClaw 后续 work

1. **追踪上游 PR**：把这份 PR 提到 `https://gitcode.com/openJiuwen/jiuwenclaw.git` `enterprise_dev`
2. **PR merge 后**：
   - 上游 release 新版本 / 标签 / commit
   - 更新 `vendor/jiuwenclaw/.clowder-source.json` 的 `requestedRef` 或 `resolvedCommit`
   - 跑 `pnpm vendor:sync:jiuwenclaw` 拉新 vendor，会**覆盖**本次 patch（这是预期行为）
3. **撤掉本地 patch**：vendor sync 完成后此文档可归档到 `docs/discussions/archive/`
4. **可选**：如果想不破坏旧 jiuwenclaw client，可以让 OfficeClaw 前端发**双字段**（`office_claw_mcp` + `cat_cafe_mcp` 同值），过渡期 N 个版本后再清理 — 见 [discussion 选项 C](../discussions/2026-05-07-9e49fb6b-merge-audit.md#strategy-update-2026-05-07-1925)

## 验证记录

- ✅ `grep -rn "cat_cafe_mcp" vendor/jiuwenclaw/`（除 `.pyc` 缓存）残留 0
- ✅ `office_claw_mcp` 11 处就位
- ✅ 函数名 `register_request_scoped_office_claw_mcp` 在定义点 + 2 处调用点同步

---

## ⛔ 已撤回（2026-05-08）— `CAT_CAFE_MCP_CWD` env var 不要 patch

曾经一度尝试把 jiuwenclaw 内 `CAT_CAFE_MCP_CWD` env var 也改成 `OFFICE_CLAW_MCP_CWD`，**这是错误的方向，已撤回**。

### 为什么不该 patch

OfficeClaw 这边的 `OFFICE_CLAW_MCP_CWD`（在 `relayclaw-sidecar.ts:232` 设置）跟 jiuwenclaw 的 `CAT_CAFE_MCP_CWD` **不是同一个 env var 在两边的不同命名**——它们语义不同：

| env var | 端 | 语义 |
|---|---|---|
| `OFFICE_CLAW_MCP_CWD` | OfficeClaw sidecar 注入 jiuwenclaw 进程 | sidecar env block 里跟 SERVER_PATH/COMMAND/ARGS_JSON 一组的"office-claw mcp server **启动 cwd**"（OfficeClaw repo root） |
| `CAT_CAFE_MCP_CWD` | jiuwenclaw 内 `tool_manager.py:221` / `interface.py:337-338` | jiuwenclaw 期望宿主告诉它的"**宿主项目 root**"（去那里找 `.mcp.json` 加载 host MCP servers） |

OfficeClaw 自家 MCP 工具完全通过 `office_claw_mcp` 请求字段动态注册（per-request ephemeral），**不需要** jiuwenclaw 加载 `.mcp.json` 这条 host project 路径。OfficeClaw 也没有"传递用户项目 .mcp.json"这个 feature 需求。

之前 OfficeClaw 没设过 `CAT_CAFE_MCP_CWD`（旧名）→ jiuwenclaw 永远 early-return → 永远不加载 `.mcp.json` → **这是稳态、是正确的**。

### Patch 触发的 bug

如果硬把 jiuwenclaw 改成读 `OFFICE_CLAW_MCP_CWD`，jiuwenclaw 会读到 OfficeClaw 设的 OfficeClaw repo root 值，把它误作宿主项目 root 去加载里面的 `.mcp.json`。OfficeClaw repo 内的 `.mcp.json` 是给开发者用 Cursor / Claude Desktop 配 MCP client 用的（目前还含旧 `cat-cafe-collab`/`memory`/`signals` server entries），jiuwenclaw 加载时调到 `Runner.resource_mgr.add_mcp_server`（openjiuwen 框架）下游有个 `.message` 访问的 bug，会触发 `'str' object has no attribute 'message'` warning，并间接导致流式处理被中断（OfficeClaw 这边 socket 异常 → invocationTracker.cancelAll）。

### 不动的项（确认无影响）

- `vendor/jiuwenclaw/utils.py:1416-1417` 的 `CAT_CAFE_CALLBACK_TOKEN` / `CAT_CAFE_USER_ID` —— 只是正则脱敏 docstring 里的例子，不是真实读取。OfficeClaw 这边对应 env var 是 `OFFICE_CLAW_CALLBACK_TOKEN` / `OFFICE_CLAW_USER_ID`，jiuwenclaw 也不读，纯 docstring noise。
- `_CAT_CAFE_SERVER_NAME_PREFIX` / `_REQUEST_SCOPED_CAT_CAFE_SERVER_ID` / `_get_cat_cafe_stdio_params()` / `_CAT_CAFE_STDIO_PARAMS` ContextVar / `self._cat_cafe_ephemeral_tools` —— 全部是 jiuwenclaw 进程内部命名，不通过协议穿越进程边界，OfficeClaw 看不到。功能 0 影响，仅日志可读性的小残留。
- **`CAT_CAFE_MCP_CWD` env var**（含 `tool_manager.py:221` + `interface.py:337-338` 的日志/读取）—— OfficeClaw 不设这个 env var，jiuwenclaw 走 early return 是预期行为。

### 撤回操作

vendor working tree 的 3 处 `OFFICE_CLAW_MCP_CWD` 已改回 `CAT_CAFE_MCP_CWD`。

---

## Patch 第二批（2026-05-08 11:25）— `ask_user_question` 工具 schema 缺 `items`

**起因**：jiuwenclaw 调用 OpenAI 兼容模型（gpt-5.2）时报错：

```
[181001] model call failed, reason: openAI API async stream error:
BadRequestError: Error code: 400 - {'error': {'message':
"Invalid schema for function 'ask_user_question': In context=
('properties', 'questions', 'type', '0'), array schema missing items.",
'type': 'invalid_request_error', ...}}
```

OpenAI Strict mode 要求：当 `"type"` 是 union 且包含 `"array"` 时，必须配套定义 `"items"` 字段（描述 array 元素 schema）。jiuwenclaw 这边定义了 `"type": ["array", "string"]` 但没定义 `"items"`。

### 改动点（1 处）

`vendor/jiuwenclaw/jiuwenclaw/agentserver/tools/ask_user_question_tool.py` L268-271：

```diff
 "questions": {
     "type": ["array", "string"],
+    "items": {"type": "object"},
     "description": "问题列表：JSON 数组，或 JSON 数组的字符串形式",
 },
```

minimal items 用 `{"type": "object"}`——array 元素必为 dict（含 `question` / `options[{label, description?}]` / 可选 `header` / `multi_select`，详见 `_ASK_TOOL_CARD` description）。如果上游想更严格也可以补完整的 nested schema：

```python
"items": {
    "type": "object",
    "properties": {
        "question": {"type": "string"},
        "options": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "description": {"type": "string"},
                },
                "required": ["label"],
            },
        },
        "header": {"type": "string"},
        "multi_select": {"type": "boolean"},
    },
    "required": ["question", "options"],
},
```

但本 patch 选最小改动（minimal items shape）以降低对上游既有逻辑的扰动。

### 影响 / 触发面

`questions` 字段是 union type 主要为了兼容"LLM 直接传 JSON 数组"和"LLM 传 JSON 字符串然后 jiuwenclaw 这边 json.loads"两种调用风格。union type 本身合理；但**所有 OpenAI strict-schema 模型**（GPT-4o function calling、GPT-5.x）都会触发这个 400。

### 不影响 Anthropic 端

Anthropic / Claude 这边的 tool input schema 验证不像 OpenAI strict mode 严格——这条 missing `items` 不会被 Anthropic 拒绝。所以历史用 Claude 模型的 jiuwenclaw 用户不会暴露这个 bug。

### 上游 PR 模板补充

第一批 PR 的 ## Changes 下追加一节：

```markdown
### `jiuwenclaw/agentserver/tools/ask_user_question_tool.py`
- L270 (after `"type": ["array", "string"],`):
  add `"items": {"type": "object"},` to satisfy OpenAI strict-schema
  validation (BadRequestError when calling GPT-4o/5.x with this tool
  registered).
```

[宪宪/Opus-47🐾]
