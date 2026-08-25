# ArkLifeguard 空指针分析 Quick Start

ArkLifeguard 可以从 HarmonyOS/ArkTS 工程目录开始，依次完成 Scene 构建、类型推断、有界生命周期 DummyMain 生成、空指针 IFDS 分析和报告输出。当前 CLI 不运行资源泄漏分析，也不需要 GUI。

## 1. 环境准备

需要：

- Node.js 18 或更高版本；
- npm；
- HarmonyOS/OpenHarmony ETS SDK；
- 待分析应用的完整工程目录。

在 ArkLifeguard 根目录安装依赖：

```bash
npm ci
```

### SDK 放置方式

默认从以下目录发现 SDK：

```text
ArkLifeguard/
└── sdk/
    └── default/
        ├── openharmony/
        │   └── ets/
        └── hms/
            └── ets/
```

`openharmony/ets` 和 `hms/ets` 至少存在一个即可。SDK 不在默认位置时，可以在命令中使用 `--sdk-root` 或 `--sdk`。

## 2. 运行一次完整分析

在 ArkLifeguard 根目录执行：

```bash
npm run cli -- analyze "/absolute/path/to/HarmonyOSApp" \
  --format json \
  --output out/nullness-report.json
```

工程路径建议使用绝对路径。执行成功后，JSON 报告写入 `out/nullness-report.json`。

如果 SDK 位于其他目录：

```bash
npm run cli -- analyze "/absolute/path/to/HarmonyOSApp" \
  --sdk-root "/absolute/path/to/sdk-root" \
  --format json \
  --output out/nullness-report.json
```

`--sdk-root` 所指目录下应存在 `openharmony/ets` 或 `hms/ets`。也可以直接指定一个或多个 ETS SDK 目录：

```bash
npm run cli -- analyze "/absolute/path/to/HarmonyOSApp" \
  --sdk "/absolute/path/to/openharmony/ets" \
  --sdk "/absolute/path/to/hms/ets" \
  --format json \
  --output out/nullness-report.json
```

## 3. 配置有界分析参数

推荐显式保留默认边界，便于复现分析结果：

```bash
npm run cli -- analyze "/absolute/path/to/HarmonyOSApp" \
  --format json \
  --output out/nullness-report.json \
  --max-callback-iterations 1 \
  --max-abilities-per-flow 3 \
  --max-navigation-hops 5 \
  --max-access-path-length 5 \
  --max-propagation-depth 40
```

| CLI 参数 | 默认值 | 当前作用 |
|---|---:|---|
| `--max-callback-iterations` | 1 | 限制 Ability、Component 和 UI 回调序列的展开轮数；直接影响 DummyMain CFG 规模。 |
| `--max-access-path-length` | 5 | 限制空指针 Fact 跟踪的字段/数组访问路径长度。 |
| `--max-propagation-depth` | 40 | 限制会改变 Fact 的传播深度，用于抑制真实工程中的无界增长。 |
| `--max-abilities-per-flow` | 3 | 保留在统一有界配置中；当前资源/污点分析关闭，空指针 Fact 不消费此参数。 |
| `--max-navigation-hops` | 5 | 保留在统一有界配置中；当前资源/污点分析关闭，空指针 Fact 不消费此参数。 |

报告中的 `settings.bounds` 保存参数数值，`settings.boundEnforcement` 说明参数在本次分析中是否实际生效。

## 4. 报告格式

`--format` 支持：

- `json`：便于脚本处理和后续统计；
- `text`：适合直接在终端阅读；
- `markdown`：适合归档到项目文档；
- `html`：生成可直接用浏览器打开的静态报告，不需要 GUI 或服务器。

如果不指定 `--output`，报告会输出到标准输出：

```bash
npm run cli -- analyze "/absolute/path/to/HarmonyOSApp" --format text
```

需要生命周期、Component 和导航细节时增加 `--detailed`。使用 `--verbose` 时建议同时指定 `--output`，避免详细日志与标准输出中的报告混合。

## 5. 阅读 JSON 空指针报告

主要字段：

- `status`：完整链路是否成功；
- `summary.nullDereferences`：空指针候选报告数；
- `summary.reachedStatements` 和 `summary.reachedFacts`：IFDS 到达规模；
- `dummyMain`：生命周期入口、基本块和调用统计；
- `nullness.success`：空指针分析是否成功；
- `nullness.diagnostics`：具体的空指针候选位置；
- `warnings` 和 `errors`：降级建模信息与分析错误。

单条 `nullness.diagnostics` 包含：

- `nullness`：`null`、`undefined`、`maybe-null` 等空值状态；
- `accessPath`：被解引用的局部变量或字段路径；
- `source`：空值来源位置；
- `dereference`：解引用位置；
- `confidence`：报告置信度；
- `description`：问题摘要。

例如，可以用 Node.js 提取所有解引用位置：

```bash
node -e "const r=require('./out/nullness-report.json'); for (const d of r.nullness.diagnostics) console.log(d.dereference.relativePath + ':' + d.dereference.line + ':' + d.dereference.col)"
```

## 6. 使用编译后的 CLI

构建项目：

```bash
npm run build
```

然后执行：

```bash
node dist/cli/main.js analyze "/absolute/path/to/HarmonyOSApp" \
  --format json \
  --output out/nullness-report.json
```

查看完整命令帮助：

```bash
node dist/cli/main.js analyze --help
```

## 7. 退出码

| 退出码 | 含义 |
|---:|---|
| `0` | Scene、生命周期和启用的空指针分析全部完成。 |
| `1` | 命令参数、工程路径、SDK 或 Scene/生命周期构建失败。 |
| `2` | 报告已生成，但空指针分析返回失败状态。 |

检出空指针候选问题本身不会让 CLI 返回非零退出码。

## 8. 常见问题

### 找不到 SDK

确认 `--sdk-root` 下存在 `openharmony/ets` 或 `hms/ets`，或使用 `--sdk` 直接指向 ETS SDK 目录。

### 大型项目内存不足

可以增加 Node.js 堆内存上限：

```bash
NODE_OPTIONS=--max-old-space-size=4096 npm run cli -- analyze "/absolute/path/to/HarmonyOSApp" \
  --format json --output out/nullness-report.json
```

### 报告出现 `Skipping ViewTree`

某个 Component 的 ViewTree 在新版 ArkAnalyzer 中可能因递归泛型无法完整构建。ArkLifeguard 会跳过该 Component 的 ViewTree，继续分析其他生命周期和空指针路径。这是局部降级，可能遗漏该 Component 的 UI 回调路径。

### 报告数为 0

0 条报告只表示在当前模型和有界参数下未找到候选问题，不等于证明应用中不存在空指针风险。真实项目结果仍需要结合源码进行人工审核。

## 9. 常用辅助选项

- `--report-unresolved-returns`：输出由未解析返回类型导出的低置信度报告；
- `--no-navigation`：不收集导航关系；
- `--no-ui-callbacks`：不通过 ViewTree 提取 UI 回调；
- `--no-infer-types`：跳过类型推断，可能显著影响空指针结果；
- `--no-nullness`：只生成生命周期结果，不运行空指针分析。

进行正式空指针检测时，不建议使用后三个关闭选项。
