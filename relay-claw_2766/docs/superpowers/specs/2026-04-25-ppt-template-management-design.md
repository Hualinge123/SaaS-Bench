# OfficeClaw PPT 模板管理设计

## 背景

当前 OfficeClaw 已具备通过 `pptx-craft` 生成 PPT 的能力，前端也已经有模板选择器的基础 UI，但模板管理能力仍未真正落地。

当前已知事实：

1. `packages/web/src/components/TemplatePicker.tsx` 已有“平台推荐 / 我的模板”双 Tab、上传入口和选择交互骨架，但当前仍使用 mock 数据。
2. 当前已存在 `ppt-template-generate`，可将上传的 PPT 转换为特定目录下的 PPT 模板目录。
3. 当前服务是本地部署的单机模式，没有多用户场景。
4. 本次需求只做模板管理能力本身，不做“通过模板名触发 PPT 生成”的能力。
5. 本次不修改 `pptx-craft` 的接口、参数和实现。
6. 当前 `.office-claw/ppt-template` 下已有一份真实模板目录：`暖橙童趣/`，应以该目录结构作为实现和文档的事实依据。

本设计关注的是：

1. 把预置模板和上传生成模板统一纳入产品管理。
2. 为前端提供模板列表、上传生成、删除、状态查询能力。
3. 把模板元数据和模板目录稳定落盘到本地 `.office-claw/ppt-template`。

## 目标

1. 为前端提供统一的 PPT 模板列表接口。
2. 为前端提供“上传 PPT -> 生成模板”的接口。
3. 为前端提供用户模板重命名、删除能力。
4. 为后端提供统一的模板注册与本地存储层，统一管理预置模板和上传模板。
5. 将所有模板元数据和模板文件夹统一存放到 `.office-claw/ppt-template`。
6. 为后续调用 `pptx-craft` 生成对应风格 PPT 预留稳定的风格标识名称。

## 非目标

1. 本期不做“用户直接输入展示名称触发 PPT 生成”的完整产品能力。
2. 本期不修改 `pptx-craft` 的调用参数和实现逻辑。
3. 本期不定义新的模板 DSL。
4. 本期不做模板在线编辑。
5. 本期不做模板共享、权限隔离、多用户能力。
6. 本期不做模板版本管理和回滚。

## 当前现状

### 前端现状

文件：`packages/web/src/components/TemplatePicker.tsx`

当前状态：

1. 已有“平台推荐 / 我的模板”双 Tab UI。
2. 已有上传入口、拖拽上传、桌面端文件选择器接入。
3. 已有模板选中状态和“做同款”交互骨架。
4. 预置模板数据当前为 `MOCK_PRESET_TEMPLATES`。
5. 我的模板数据当前为 `MOCK_MY_TEMPLATES`。
6. 上传当前仅做本地延时模拟，没有实际 API。
7. 删除逻辑尚未接通后端。

这说明前端视觉和交互骨架已具备，但没有真实数据源，也没有本地模板存储和管理能力。

### 预置模板现状

文件：`office-claw-skills/pptx-craft/styles/`

当前可作为预置模板来源的风格文件包括：

1. `light-tech.md`
2. `dark-tech.md`
3. `paper-humanities.md`
4. `huawei.md`

产品侧可将这些风格文件包装为“平台推荐模板”返回给前端。

### 上传模板现状

文件：`office-claw-skills/ppt-template-generate/SKILL.md`

`ppt-template-generate` 当前负责把上传的 `.pptx` 文件提取为一个模板目录，核心产物是：

1. `{风格名}.md` 样式规范文件
2. `slides/` 页面图片目录
3. `temp/template_data.json` 中间数据文件

当前 OfficeClaw 主产品还没有把这块能力接成正式接口，也没有把生成结果统一纳入本地模板仓库，同时也还没有把模板的“展示名称”和“风格标识名称”区分开管理。

## 核心设计

### 总体思路

引入一个新的“PPT 模板管理层”，位于前端模板面板和本地模板存储之间。

```text
前端 TemplatePicker
        |
        v
PPT Template API
        |
        v
PptTemplateRegistry + TemplateStore + TemplateGenerationService
        |
        +-- 预置模板（来自 pptx-craft/styles）
        |
        +-- 上传模板（来自 ppt-template-generate 的输出目录）
        |
        +-- 本地持久化目录（.office-claw/ppt-template）
```

核心原则：

1. 前端不感知模板底层来源，只消费统一模板列表。
2. 后端统一维护模板注册与过渡态。
3. 上传模板的实际生成由后端拼接 prompt 后触发 `ppt-template-generate` skill 完成。
4. 模板目录和模板元数据索引统一落在 `.office-claw/ppt-template` 下。
5. 上传模板的注册源是根目录下的 `template-meta.json`；后端仅在初始化 bootstrap 或新模板落盘时扫描目录并更新该索引。

## 数据模型

### 模板来源

定义两类模板：

1. `builtin`：来自 `pptx-craft` 预置风格文件。
2. `user`：通过上传 PPT 由 `ppt-template-generate` 生成的本地模板。

### 模板元数据结构

建议新增统一数据模型：

```ts
type PptTemplateSource = 'builtin' | 'user';
type PptTemplateStatus = 'ready' | 'generating' | 'failed';

interface PptTemplateRecord {
  templateId: string;
  name: string;
  source: PptTemplateSource;
  status: PptTemplateStatus;
  description?: string;
  previewImageUrl?: string;
  previewImagePath?: string;
  templateDir?: string;
  originFileName?: string;
  originFilePath?: string;
  generatorSkill?: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}
```

字段说明：

1. `templateId`：系统唯一 ID，例如 `builtin:light-tech`、`user:company-blue`。
2. `name`：模板名称，也是后续传给 `pptx-craft` 的风格名称。对预置模板不可重命名；对自定义模板在生成完成后可被用户重命名。上传接口中的 `name` 在当前实现里只作为生成中的临时展示名，生成完成后以后端扫描到的最终模板名称为准。
4. `source`：区分预置模板和上传生成模板。
5. `status`：用于前端展示“模版生成中”。
6. `previewImageUrl`：前端展示用封面图数据。本期接口直接返回图片内容，建议使用 `data:` URL。
7. `previewImagePath`：本地预览图路径。
8. `templateDir`：模板目录路径。上传模板时指向 `ppt-template-generate` 生成出的目录。
9. `originFileName`：原始上传文件名。
10. `originFilePath`：原始上传文件本地路径。
11. `generatorSkill`：记录产物来源，上传模板固定为 `ppt-template-generate`。

### 模板元数据索引

所有上传模板共享一份根目录索引文件：

```text
.office-claw/ppt-template/template-meta.json
```

该文件由后端维护，是上传模板的唯一元数据注册表。`ppt-template-generate` skill 只需要稳定产出模板目录本身，不负责写任何元数据索引。

示例：

```json
{
  "templates": [
    {
      "id": "qi-ye-lan",
      "name": "企业蓝",
      "keywords": ["企业", "蓝色", "商务"],
      "description": "深蓝商务汇报风格，适合企业发布会与正式汇报。",
      "path": "企业蓝/企业蓝.md",
      "source": "company-template.pptx",
      "createdAt": "2026-04-25T10:00:00.000Z",
      "updatedAt": "2026-04-25T10:00:00.000Z"
    }
  ]
}
```

## 本地存储设计

### 存储根目录

本项目为本地单机服务，模板统一存放在：

```text
.office-claw/ppt-template/
```

### 存储内容划分

该目录中存两类内容：

1. 根级模板元数据索引文件（`template-meta.json`）。
2. 每个模板对应的模板文件夹，以及上传源文件临时目录（如 `_uploads/`）。

建议目录结构：

```text
.office-claw/
  ppt-template/
    template-meta.json
    _uploads/
    企业蓝/
      企业蓝.md
      slides/
      temp/
    中国风/
      中国风.md
      slides/
      temp/
```

说明：

1. 根目录 `template-meta.json` 是所有上传模板的统一元数据索引。
2. 每个生成模板是一个文件夹。
3. 模板文件夹直接落在 `.office-claw/ppt-template/` 下，不再额外分用户目录。
4. 当前真实存在的模板目录示例为：`.office-claw/ppt-template/暖橙童趣/`。

## 预置模板设计

预置模板本期统一返回默认封面图：

`packages/web/public/images/default-ppt-template.png`

接口层不返回静态文件 URL，而是直接返回该图片内容对应的 `data:` 图片数据。

| 产品展示名 | `templateId` | 来源文件 | 预览图 |
|-----------|--------------|----------|--------|
| 浅色科技风 | `builtin:light-tech` | `office-claw-skills/pptx-craft/styles/light-tech.md` | 默认图片 |
| 深色科技风 | `builtin:dark-tech` | `office-claw-skills/pptx-craft/styles/dark-tech.md` | 默认图片 |
| 纸质人文风 | `builtin:paper-humanities` | `office-claw-skills/pptx-craft/styles/paper-humanities.md` | 默认图片 |
| 华为风格 | `builtin:huawei` | `office-claw-skills/pptx-craft/styles/huawei.md` | 默认图片 |

预置模板本期只需要满足前端列表展示，不要求落本地模板文件夹。

## 上传模板产物结构

根据当前 `.office-claw/ppt-template/暖橙童趣/` 的真实目录结构，上传模板产物应以实际落盘结构为准：

```text
{template_dir}/
  {风格名}.md
  slides/
    slide-001.png
    slide-002.png
    ...
  temp/
    template_data.json
```

说明：

1. `{风格名}.md` 是模板核心规范文件。
2. `slides/` 是 PPT 转换得到的页面图片。
3. `temp/template_data.json` 是工具提取的结构化数据。
4. 当前真实模板目录中未体现 `vlm_analysis.json`，因此产品实现不应依赖该文件存在。

因此产品侧需要直接兼容这个目录结构，不应假设存在 `manifest.json`、`preview.png`、`assets/`、`layout/` 或 `vlm_analysis.json` 等文件。

### 当前联调约定

由于模板生成链路当前较慢，联调阶段先做 mock：

1. 模板列表扫描时统一返回 `.office-claw/ppt-template/暖橙童趣` 这个模板。
2. 上传生成链路后续再继续接成真实完整流程。

## 后端设计

### 新增模块建议

建议新增以下后端模块：

1. `packages/api/src/domains/ppt/templates/PptTemplateRegistry.ts`
2. `packages/api/src/domains/ppt/templates/PptTemplateStore.ts`
3. `packages/api/src/domains/ppt/templates/PptTemplateBuiltinLoader.ts`
4. `packages/api/src/domains/ppt/templates/PptTemplateGenerationService.ts`
5. `packages/api/src/routes/ppt-templates.ts`

职责划分：

1. `PptTemplateBuiltinLoader`：注册预置模板。
2. `PptTemplateStore`：读取根目录 `.office-claw/ppt-template/template-meta.json` 作为注册索引，并在初始化 bootstrap 或新模板落盘时扫描模板目录更新该索引，同时维护上传过渡态。
3. `PptTemplateRegistry`：统一提供 `list/get/register/rename/delete`。
4. `PptTemplateGenerationService`：负责上传 PPT 后拼接 prompt，触发 `ppt-template-generate` skill，并通过扫描新增模板目录完成结果落库。
5. `ppt-templates.ts`：提供前端 API。

### API 设计

#### 1. 获取模板列表

```http
GET /api/ppt-templates
```

查询参数：

1. `source=builtin|user|all`，默认 `all`
2. `includeGenerating=true|false`，默认 `true`

返回：

```json
{
  "templates": [
    {
      "templateId": "builtin:light-tech",
      "name": "浅色科技风",
      "source": "builtin",
      "status": "ready",
      "previewImageUrl": "data:image/png;base64,...",
      "description": "适合科技、产品、方案汇报"
    },
    {
      "templateId": "user:company-blue",
      "name": "企业蓝",
      "source": "user",
      "status": "ready",
      "previewImageUrl": "data:image/png;base64,..."
    }
  ]
}
```

规则：

1. `builtin` 模板和 `user` 模板统一返回给当前本地服务前端。
2. 结果默认按 `builtin` 在前、`user` 在后，再按 `updatedAt desc` 排序。
3. `previewImageUrl` 字段直接返回图片内容，建议为 `data:` URL，而不是静态资源 URL。

#### 2. 上传 PPT 生成模板

```http
POST /api/ppt-templates/upload
Content-Type: multipart/form-data
```

表单字段：

1. `file`: `.pptx`
2. `name`: 可选，生成中的临时展示名称；当前实现中最终模板名称由 `ppt-template-generate` 产出的模板目录名称决定

返回：

```json
{
  "template": {
    "templateId": "user:company-blue",
    "name": "企业蓝",
    "source": "user",
    "status": "generating"
  }
}
```

执行流程：

1. 校验文件类型和大小。
2. 先写入一条 `status=generating` 的模板记录，并立即持久化到根目录 `template-meta.json`。
3. 将上传文件保存到受控临时目录。
4. 后端拼接 prompt 并请求大模型触发 `ppt-template-generate` skill。
5. prompt 中必须明确：这是生成 PPT 风格模板任务；输出目录必须是 `.office-claw/ppt-template`；输出结果必须包含模板主文件、`slides/` 和 `temp/`。
6. skill 将生成出的模板目录落盘到 `.office-claw/ppt-template/{模板目录名}/`。
7. 后端扫描输出根目录，定位新生成的模板目录，并校验目录中至少包含模板主文件、`slides/` 首张预览图和 `temp/template_data.json` 三类必要产物。
8. 校验通过后，将最终模板元数据注册到根目录 `template-meta.json`，并将模板状态视为 `ready`；如果模型实际产出了新的模板名称，则以该名称作为最终 `name` 和 `templateId`，同时清理原先的临时索引记录。
9. 校验失败或 skill 执行失败时，服务端过渡态回填 `status=failed` 和 `lastError`。
10. 如果服务在模板生成过程中退出，启动后会将遗留的 `status=generating` 记录统一恢复为 `status=failed`，并提示用户重新上传；当前不做生成任务续跑。

#### 3. 获取单个模板详情

```http
GET /api/ppt-templates/:templateId
```

用途：

1. 前端轮询模板生成状态。
2. 调试上传生成链路。

#### 4. 重命名用户模板

```http
PATCH /api/ppt-templates/:templateId
Content-Type: application/json
```

请求体：

```json
{
  "name": "企业蓝升级版"
}
```

规则：

1. 仅允许修改模板展示名称 `name`。
2. `builtin` 模板禁止重命名，保持平台推荐名称稳定。
3. `user` 模板仅在 `status=ready` 时允许重命名；`failed` 模板只允许删除，不允许重命名。
4. 重命名需要同时更新模板元数据、模板目录名称和模板主规范文件名称。

#### 5. 删除用户模板

```http
DELETE /api/ppt-templates/:templateId
```

规则：

1. 仅允许删除 `source=user` 的模板。
2. 删除时一并删除模板元数据和模板目录。
3. `builtin` 模板不可删除。

## 与 `pptx-craft` 的后续衔接

本期不实现完整的模板化生成链路，但模板数据结构需要为后续接入预留字段。

后续当调用 `pptx-craft` 生成对应风格 PPT 时：

1. 前端页面展示使用 `name`。
2. skill 识别使用 `name`。
3. 在发送给 `pptx-craft` 的 prompt 中，拼接 `name` 作为 PPT 风格名称；如果是自定义模板，同时拼接模板目录路径和模板主文件路径。

建议的 prompt 形式：

```text
请使用风格「{name}」生成 PPT。

{用户原始需求}
```

这里的关键约束是：

1. 预置模板名称固定，可直接作为风格名称传给 `pptx-craft`。
2. 自定义模板名称在重命名时会同步更新目录和主规范文件，因此也可直接作为风格名称使用。

### 错误语义

建议统一：

1. `404 template_not_found`
2. `409 template_name_conflict`
3. `422 invalid_ppt_template_file`

## 前端设计

### TemplatePicker 改造

文件：`packages/web/src/components/TemplatePicker.tsx`

当前组件可以保留大部分结构，仅替换数据源和行为：

1. 首屏加载调用 `GET /api/ppt-templates`。
2. `平台推荐` Tab 过滤 `source=builtin`。
3. `我的模板` Tab 过滤 `source=user`。
4. 上传调用 `POST /api/ppt-templates/upload`。
5. 上传成功后先插入 `generating` 项，再轮询详情或刷新列表。
6. 重命名调用 `PATCH /api/ppt-templates/:templateId`。
7. 删除调用 `DELETE /api/ppt-templates/:templateId`。

### 前端返回字段建议

前端组件实际只需要以下展示字段：

```ts
interface PptTemplateViewModel {
  templateId: string;
  name: string;
  source: 'builtin' | 'user';
  status: 'ready' | 'generating' | 'failed';
  previewImageUrl: string | null;
  description?: string;
}
```

其中：

1. `name` 用于页面展示。
2. `name` 用于展示，也用于后续生成链路传给 skill。
3. 上传接口中的 `name` 在当前实现里仅用于生成中的临时展示；生成完成后以后端扫描出的最终模板名为准。
4. `previewImageUrl` 直接可用于 `<img src>` 渲染。

建议后端直接返回这个结构，减少前端转换。

### 上传交互

建议保持现有 UX：

1. 上传后立即展示占位卡片。
2. 状态文案保持“模版生成中”。
3. 失败时展示 toast，并把卡片状态改成 `failed` 或移除。
4. 预置模板预览图为空时，前端也应能正常展示占位样式。

建议初期采用简单轮询：

1. 上传后每 2 秒请求 `GET /api/ppt-templates/:templateId`。
2. 轮询超时建议 2 分钟。

## 单机本地模式约束

当前服务为本地部署单机模式，没有多用户隔离。

规则：

1. 预置模板和上传模板统一对当前本地服务可见。
2. 后端不能相信前端传来的任意路径，只能根据 `templateId` 反查本地模板目录。
3. 所有模板目录都必须位于 `.office-claw/ppt-template` 受控根目录下。

## 命名规则

模板名就是用户在前端看到的字符串，例如：

1. `浅色科技风`
2. `企业蓝`
3. `2026 财报汇报模板`

冲突策略：

1. `builtin` 名称全局唯一。
2. 本地上传模板名称唯一。
3. 上传模板名称与预置模板重名时，建议直接禁止。

### 模板名称规则

模板名称规则：

1. 预置模板使用固定名称，例如 `浅色科技风`、`深色科技风`。
2. 自定义模板在生成完成后以模型产出的最终模板名称为准，并允许后续重命名。
3. 自定义模板重命名时，需要同步更新模板目录名称与主规范文件名称。

## 与 `ppt-template-generate` 的兼容

本方案要求后端通过 prompt 驱动 `ppt-template-generate`，skill 只需要稳定产出模板目录：

1. 输入文件路径。
2. 输出模板目录根路径。
3. 模板目录结构符合 skill 当前文档约定。
4. 模板目录中至少包含 `{风格名}.md`、`slides/`、`temp/template_data.json`。
5. 产品层仅将同时满足这三类产物存在的目录视为 `ready` 模板；缺少任意一项时，生成任务应标记为 `failed`，不得注册为可用模板。

后端给大模型的 prompt 至少应包含如下语义：

```text
将此ppt生成一个风格模板，放在.office-claw/ppt-template目录下，输出模板目录及其必要产物。
```

## 实施分期

### Phase 1：模板注册与列表接口

范围：

1. 建立 `PptTemplateRegistry` 和 `PptTemplateStore`。
2. 注册预置模板。
3. 提供 `GET /api/ppt-templates`。
4. 前端 `TemplatePicker` 从 mock 切到真实接口。

### Phase 2：上传 PPT 生成本地模板

范围：

1. 提供 `POST /api/ppt-templates/upload`。
2. 接入大模型 prompt 驱动的 `ppt-template-generate` skill。
3. 将模板目录和根目录索引 `template-meta.json` 统一落到 `.office-claw/ppt-template/`。
4. 提供 `GET /api/ppt-templates/:templateId` 供轮询。

### Phase 3：删除与稳定化

范围：

1. 提供 `PATCH /api/ppt-templates/:templateId`。
2. 提供 `DELETE /api/ppt-templates/:templateId`。
3. 完善模板元数据落盘和目录清理。
4. 补充错误提示与状态处理。

### Phase 4：后续扩展（非本期）

范围：

1. 评估并持续优化调用 `pptx-craft` 时基于 `name`、模板目录路径和主规范文件路径的 prompt 拼接。
2. 评估是否补模板预览图生成。
3. 如有必要，再补模板状态事件推送。

## 测试建议

### 后端测试

1. 预置模板加载成功，列表接口可返回。
2. 列表接口能返回预置模板和本地上传模板。
3. 上传非 `.pptx` 文件返回 422。
4. 上传 PPT 后服务端过渡态先进入 `generating`。
5. `ppt-template-generate` skill 成功产出模板目录后，后端更新根目录 `template-meta.json`，模板变为 `ready`。
6. `ppt-template-generate` skill 失败后模板过渡态变为 `failed`。
7. 服务在模板生成过程中退出后，重启时遗留的 `generating` 记录会被恢复为 `failed`。
8. 缺少模板主文件、`slides/` 首张预览图或 `temp/template_data.json` 的目录不会被注册为 `ready` 模板。
9. 不能删除 `builtin` 模板。
10. 模板目录路径不能逃逸 `.office-claw/ppt-template` 受控根目录。
11. 预置模板返回默认图片的 `data:` 数据。
12. 本地模板返回实际封面图的 `data:` 数据。
13. 同名模板冲突返回 409。
14. 重命名自定义模板时，`name`、模板目录名称和主规范文件名称同步变化。

### 前端测试

1. `TemplatePicker` 能展示真实预置模板列表。
2. 上传模板后显示“模版生成中”卡片。
3. 模板生成成功后卡片自动刷新为可选状态。
4. 模板生成失败后有错误提示。
5. 搜索“我的模板”能按名称过滤。
6. 重命名后列表即时更新。
7. 删除后列表即时移除。
8. 预置模板显示默认模板图。
9. 本地模板显示实际封面图。

### 端到端测试

1. 上传一个 `.pptx`，成功生成模板并在“我的模板”中可见。
2. `.office-claw/ppt-template/暖橙童趣/` 能被正确扫描并返回。
3. 返回结果中的封面图字段可直接渲染。
4. 根目录 `template-meta.json` 中新增对应模板元数据。
5. 重命名模板后，展示名称、模板目录名称和主规范文件名称同步更新。
6. 删除模板后目录和元数据都被正确清理。
7. 在模板生成过程中退出服务并重启后，原任务以 `failed` 状态保留在“我的模板”中，而不是消失或继续停留在 `generating`。

## 风险与应对

### 风险 1：`ppt-template-generate` 输出不稳定

问题：

如果 `ppt-template-generate` 输出目录结构不稳定，后端将无法可靠识别模板主文件和预览图。

应对：

1. 产品层只依赖 `{风格名}.md`、`slides/`、`temp/template_data.json` 这三个稳定产物。
2. 根目录 `template-meta.json` 由后端维护，不把注册职责交给 skill。
3. 启动扫描和生成完成判定都必须复用同一套产物完整性校验，避免半成品目录被误注册为可用模板。

### 风险 2：展示名称与标识名称混用

问题：

如果模板重命名后没有同步更新目录和主规范文件名称，会导致自定义模板生成链路失效。

应对：

1. 页面展示使用 `name`。
2. skill 识别使用 `name`。
3. 自定义模板重命名时同步更新目录和主规范文件，保持生成链路一致。
4. 上传阶段允许出现临时占位名称，但生成完成后必须切换到最终模板名称，且索引中不能残留旧的临时记录。

### 风险 3：模板目录结构随 skill 版本变化

问题：

`ppt-template-generate` 可能在不同版本下输出不同目录结构。

应对：

1. 产品层只依赖 `{风格名}.md`、`slides/`、`temp/template_data.json` 和统一适配结果。
2. 不直接把 `ppt-template-generate` 内部目录结构暴露给前端接口。

### 风险 4：服务重启导致生成中状态丢失

问题：

如果模板生成过程中服务退出，纯内存过渡态会丢失，用户会看到模板消失或状态异常。

应对：

1. `generating` / `failed` / `ready` 全部持久化到根目录 `template-meta.json`。
2. 服务启动时把遗留的 `generating` 统一恢复为 `failed`，并通过 `lastError` 提示用户重新上传。

### 风险 5：前端轮询带来的额外请求

问题：

上传后频繁轮询可能造成多余流量。

应对：

1. 初期轮询间隔 2 秒，超时 2 分钟。
2. 后续如有需要，再切到事件推送。

## 推荐落地顺序

建议按下面顺序推进：

1. 先做 `GET /api/ppt-templates`，替掉前端 mock。
2. 再做 `POST /api/ppt-templates/upload`，跑通模板生成状态流。
3. 再做重命名接口、删除接口和前端交互。

这样可以先把“模板列表”和“上传模板”做成独立可验收能力，为后续模板化生成能力提供稳定底座。

## 建议的验收标准

1. 前端可以展示系统预置模板列表。
2. 前端可以上传 `.pptx` 文件并生成本地模板。
3. 模板生成中、成功、失败状态能被正确展示。
4. 前端可以重命名和删除本地模板。
5. 每个模板都具备名称 `name`；预置模板名称固定，自定义模板名称可编辑。
6. 所有上传模板注册信息正确持久化到根目录 `template-meta.json`。
7. 上传生成的模板目录正确落盘到 `.office-claw/ppt-template/`。

## 结论

本次需求的本质仍然是先补齐“模板管理底座”，但这个底座需要同时为后续模板化生成预留稳定的风格标识。

最小正确方案是：

1. 产品层建立统一模板 registry。
2. 统一管理预置模板和上传模板。
3. 前端统一消费模板列表接口。
4. 模板目录和根目录索引 `template-meta.json` 统一落在 `.office-claw/ppt-template/` 下。
5. 每个模板以 `name` 作为展示名称和风格名称。

这样做的好处是：

1. 不需要修改 `pptx-craft` 现有主流程和参数。
2. 不再依赖 `ppt-template-generate` 生成全局注册文件。
3. 可以先独立交付模板管理能力。
4. 后续如果需要接入模板化生成，可以直接使用 `name` 在 prompt 中拼接风格名称；对自定义模板同时拼接目录路径和主规范文件路径。
