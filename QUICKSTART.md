# ArkLifeguard 快速使用指南

本文说明如何使用 ArkLifeguard 分析一个真实 HarmonyOS/OpenHarmony ArkTS 源码工程，并生成可审计的静态分析报告。

## 1. 准备环境

需要准备：

- Node.js 18 或更高版本；
- npm；
- HarmonyOS/OpenHarmony ETS SDK；
- 待分析应用的完整源码工程。

应用目录应能够被 ArkAnalyzer 读取，通常包含 `build-profile.json5`、模块级 `module.json5` 以及 `.ets`/`.ts` 源文件。ArkLifeguard 不直接分析 `.hap` 或 `.app` 安装包。

在 ArkLifeguard 根目录安装依赖：

```bash
npm ci
```

## 2. 配置 ETS SDK

### 使用默认 SDK 目录

工具默认从以下位置发现 SDK：

```text
sdk/default/
├── openharmony/ets/
└── hms/ets/
```

至少提供其中一个目录。如果仓库中已经包含可用 SDK，无需额外传参。

### 使用本机 SDK

`--sdk-root` 应指向同时包含 `openharmony/ets` 或 `hms/ets` 的上级目录：

```bash
npm run cli -- analyze "/absolute/path/to/HarmonyOSApp" \
  --sdk-root "/absolute/path/to/sdk-root" \
  --format json \
  --output out/report.json
```

也可以直接指定一个或多个 ETS SDK 目录：

```bash
npm run cli -- analyze "/absolute/path/to/HarmonyOSApp" \
  --sdk "/absolute/path/to/openharmony/ets" \
  --sdk "/absolute/path/to/hms/ets" \
  --format json \
  --output out/report.json
```

指定 `--sdk` 后，工具优先使用这些显式路径，不再从 `--sdk-root` 发现 SDK。

## 3. 运行完整分析

```bash
npm run cli -- analyze "/absolute/path/to/HarmonyOSApp" \
  --format json \
  --output out/report.json
```

工程路径包含空格或中文时应保留引号。`out/` 不存在时会自动创建。

为了便于复现实验，建议在正式分析中显式记录有界参数：

```bash
npm run cli -- analyze "/absolute/path/to/HarmonyOSApp" \
  --format json \
  --output out/report.json \
  --max-callback-iterations 1 \
  --max-abilities-per-flow 3 \
  --max-navigation-hops 5 \
  --max-access-path-length 5 \
  --max-propagation-depth 40
```

| 参数 | 默认值 | 影响范围 |
|---|---:|---|
| `--max-callback-iterations` | 1 | DummyMain 中生命周期和 UI 回调序列的展开规模。 |
| `--max-abilities-per-flow` | 3 | 单条资源流允许访问的 Ability 数量。 |
| `--max-navigation-hops` | 5 | 单条资源流允许经过的导航跳数。 |
| `--max-access-path-length` | 5 | 空指针字段、数组等访问路径长度。 |
| `--max-propagation-depth` | 40 | 资源和空指针 Fact 的传播深度。 |

## 4. 选择分析模式

使用 `--checks` 选择检查类型。默认值为 `all`，即同时运行资源泄漏和空指针检查：

```bash
# 只运行空指针分析
npm run cli -- analyze "/absolute/path/to/HarmonyOSApp" \
  --checks nullness \
  --format json \
  --output out/nullness-report.json

# 只运行资源分析
npm run cli -- analyze "/absolute/path/to/HarmonyOSApp" \
  --checks resource \
  --format json \
  --output out/resource-report.json

# 显式运行全部检查
npm run cli -- analyze "/absolute/path/to/HarmonyOSApp" \
  --checks all \
  --format json \
  --output out/report.json
```

也可以写成 `--checks nullness,resource`。未知检查名会作为参数错误处理。分析器选择统一使用 `--checks`，能够直接表达本次要运行的检查，并方便后续增加新的检查类型。

正式分析通常不建议关闭类型推断、UI 回调或导航建模。以下选项主要用于定位兼容性或性能问题：

- `--no-infer-types`：跳过类型推断；
- `--no-ui-callbacks`：不提取 ViewTree UI 回调；
- `--no-navigation`：不收集导航关系；
- `--report-unresolved-returns`：输出未解析返回值形成的低置信度空指针候选；
- `--verbose`：显示生命周期建模日志。

## 5. 选择报告格式

`--format` 支持 `json`、`text`、`markdown` 和 `html`：

```bash
npm run cli -- analyze "/absolute/path/to/HarmonyOSApp" \
  --format html \
  --output out/report.html \
  --detailed
```

未指定 `--output` 时，报告输出到标准输出。自动化处理和真实项目统计建议使用 JSON；人工审阅可使用 Markdown 或 HTML。

四种格式默认都只输出用户通常需要的内容：项目状态、空指针诊断、跨过程资源泄漏诊断、方法内资源泄漏诊断、核心数量、总耗时以及警告/错误。需要审计分析过程时再增加 `--detailed`：

```bash
npm run cli -- analyze "/absolute/path/to/HarmonyOSApp" \
  --format json \
  --output out/detailed-report.json \
  --detailed
```

详细报告额外包含 SDK 与有界参数、Ability、Component、UI 回调、导航、DummyMain、Source/Sink、传播统计和分阶段耗时。`--detailed` 只改变报告内容，不改变分析算法或诊断结果。

## 6. 解读 JSON 报告

默认 JSON 报告优先保留以下字段：

| 字段 | 含义 |
|---|---|
| `status` | 完整链路是否成功；`failed` 时继续查看 `errors`。 |
| `summary.nullDereferences` | 空指针候选数量。 |
| `summary.resourceLeaks` | 跨生命周期 IFDS 资源泄漏数量。 |
| `summary.methodLocalResourceLeaks` | 方法内资源泄漏候选数量。 |
| `nullness.diagnostics` | 空值来源、访问路径、解引用位置和置信度。 |
| `resourceAnalysis.resourceLeaks` | 资源类型、申请位置和期望释放方法。 |
| `resourceAnalysis.methodLocal.leaks` | 方法内资源检测候选。 |
| `warnings` / `errors` | 降级建模、兼容性告警和失败原因。 |
| `duration.total` | 分析总耗时。 |

使用 `--detailed` 后，JSON 恢复完整分析结果，其中 `settings`、`abilities`、`components`、`navigations`、`dummyMain` 和完整 `duration` 用于复现实验或排查分析过程。

可用 Node.js 快速提取关键结果：

```bash
node -e "const r=require('./out/report.json'); console.log({status:r.status,nullness:r.summary.nullDereferences,resourceLeaks:r.summary.resourceLeaks,methodLocal:r.summary.methodLocalResourceLeaks})"
```

方法内资源候选和 IFDS 资源泄漏采用不同分析粒度，数量不要求一致。正式结论应优先结合 `resourceAnalysis.resourceLeaks`、传播上下文和源码人工审核。

## 7. 构建并运行发布产物

```bash
npm run build
node dist/cli/main.js analyze "/absolute/path/to/HarmonyOSApp" \
  --format json \
  --output out/report.json
```

查看所有参数：

```bash
node dist/cli/main.js analyze --help
```

## 8. 大型工程与常见问题

### Node.js 内存不足

大型工程可提高堆内存上限：

```bash
NODE_OPTIONS=--max-old-space-size=4096 npm run cli -- analyze "/absolute/path/to/HarmonyOSApp" \
  --format json \
  --output out/report.json
```

如果事实规模仍然过大，应使用 `--detailed` 检查分阶段耗时，再逐步降低 `maxPropagationDepth`、`maxCallbackIterations` 或资源流边界；修改边界会影响覆盖范围，复现实验时应保留详细报告中的实际配置。

### ViewTree 无法完整构建

日志或报告出现 `Skipping ViewTree` 时，工具会跳过对应 Component 的 UI 回调并继续分析。这属于局部降级，可能减少回调路径覆盖。

### 报告数量为零

零报告只表示在当前 IR、规则、生命周期模型和边界内未发现候选问题，不代表应用已经被证明不存在空指针或资源泄漏风险。

## 9. 退出码

| 退出码 | 含义 |
|---:|---|
| `0` | 完整链路及所有启用的分析模块执行成功。 |
| `1` | 参数、工程路径、SDK 或 Scene/生命周期构建失败。 |
| `2` | 报告已经生成，但至少一个启用的分析模块返回失败状态。 |

检出候选问题本身不会让 CLI 返回非零退出码。
