# ArkLifeguard

ArkLifeguard 是面向 HarmonyOS/OpenHarmony ArkTS 应用的命令行静态分析工具。项目基于 ArkAnalyzer 构建程序 IR，通过有界生命周期模型和 IFDS 数据流分析，在不运行应用的情况下辅助发现空指针解引用与资源未释放问题。

> 项目的使用方式请阅读[快速使用指南](./QUICKSTART.md)。

## 主要功能

| 功能 | 说明 |
|---|---|
| 生命周期建模 | 收集 Ability、Component、页面生命周期和 UI 回调，生成统一 DummyMain 分析入口。 |
| 导航关系分析 | 识别页面加载、路由跳转和 Ability 导航关系，补充跨组件分析上下文。 |
| 空指针分析 | 跟踪 `null`、`undefined` 和可能为空的访问路径，报告潜在解引用位置及来源。 |
| 资源泄漏分析 | 根据 HarmonyOS 资源 Source/Sink 规则执行跨过程 IFDS 分析，检测申请后未释放的资源。 |
| 有界分析 | 限制生命周期展开、跨 Ability 传播、导航跳数、访问路径长度和 Fact 传播深度。 |
| 多格式报告 | 输出 JSON、文本、Markdown 或 HTML，包含结果摘要、位置、分析配置、耗时和告警。 |

资源分析同时保留方法内检测结果，位于 `resourceAnalysis.methodLocal`。该结果用于补充审查，不与跨生命周期 IFDS 的 `resourceAnalysis.resourceLeaks` 混合计数。当前通用 `taintLeaks` 字段主要用于接口兼容，不能等同于完整的隐私数据泄漏检测能力。

## 分析流程

```text
HarmonyOS ArkTS 工程
        │
        ▼
ArkAnalyzer Scene / IR
        │
        ▼
Ability、Component、导航与 UI 回调建模
        │
        ▼
有界生命周期 DummyMain
        │
        ├── 资源 Source/Sink IFDS 分析
        └── 空指针 IFDS 分析
        │
        ▼
JSON / Text / Markdown / HTML 报告
```

## 快速开始

推荐使用 Node.js 18 或更高版本。在项目根目录执行：

```bash
npm ci
npm run cli -- analyze "/absolute/path/to/HarmonyOSApp" \
  --checks all \
  --format json \
  --output out/report.json
```

默认同时运行资源泄漏分析和空指针分析；使用 `--checks nullness` 或 `--checks resource` 可选择单项检查。主报告始终只保留诊断和核心摘要；Ability、Component、导航和 DummyMain 等建模信息由 `--lifecycle-report <path>` 单独输出，IFDS 求解统计由 `--ifds-stats <path>` 单独输出。SDK 配置、真实工程要求、分析边界与报告解读见 [快速使用指南](./QUICKSTART.md)。

构建后也可以直接运行发布产物：

```bash
npm run build
node dist/cli/main.js analyze "/absolute/path/to/HarmonyOSApp" \
  --format json \
  --output out/report.json
```

## 项目结构

```text
ArkLifeguard/
├── src/
│   ├── adapter/              # ArkAnalyzer 适配层
│   ├── lifecycle/            # Ability、Component、导航和 DummyMain 建模
│   ├── ifds/                 # 项目自维护的 IFDS 基础设施
│   ├── analysis/
│   │   ├── nullness/         # 空指针事实、流函数、求解器和库摘要
│   │   └── resource/         # Source/Sink、资源事实、求解器和抑制逻辑
│   ├── application/          # 完整工程分析编排与公共结果结构
│   ├── report/               # JSON、文本、Markdown、HTML 报告
│   └── cli/                  # 命令行入口与参数解析
├── test/                     # 单元测试、集成测试和测试夹具
├── scripts/                  # IR 检查、基准和真实应用测试脚本
├── ArkDefectBench/           # 空指针基准样例与预期结果
├── HarmonyRealApps/          # 真实应用测试集及相关数据
├── sdk/default/              # 默认 SDK 发现目录
└── QUICKSTART.md             # 真实鸿蒙应用快速分析指南
```

业务模块不应直接依赖 ArkAnalyzer 的深层路径；相关类型和运行时导入统一由 `src/adapter/arkanalyzer.ts` 提供。

## 关键分析参数

| 参数 | 默认值 | 作用 |
|---|---:|---|
| `--max-callback-iterations` | 1 | 仅 `bounded-unroll` 使用的回调展开轮数；M0/M1 忽略。 |
| `--max-abilities-per-flow` | 0（关闭） | 可选的资源流 Ability 上限。 |
| `--max-navigation-hops` | 0（关闭） | 可选的资源流导航跳数上限。 |
| `--max-access-path-length` | 5 | 空指针访问路径的最大长度。 |
| `--max-propagation-depth` | 40 | 资源与空指针 Fact 的最大传播深度。 |

复现实验时应同时保留实际命令行参数，并按需生成独立的生命周期建模报告和 IFDS 统计报告。

## 常用开发命令

| 命令 | 用途 |
|---|---|
| `npm run typecheck` | 检查生产源码类型。 |
| `npm run typecheck:test` | 检查测试源码类型。 |
| `npm test` | 运行默认测试套件。 |
| `npm run test:lifecycle` | 运行生命周期建模测试。 |
| `npm run test:lifecycle:benchmark` | 运行 ArkDefectBench 生命周期模型受控实验。 |
| `npm run test:ifds` | 运行 IFDS 基础设施测试。 |
| `npm run test:resource` | 运行资源分析测试。 |
| `npm run test:nullness` | 运行空指针分析测试。 |
| `npm run test:cli` | 运行应用层、报告和 CLI 测试。 |
| `npm run test:nullness:bench` | 在 ArkDefectBench 上评估空指针诊断。 |
| `npm run test:nullness:real-apps` | 对真实应用执行空指针分析。 |
| `npm run test:resource:real-apps` | 对真实应用执行资源泄漏分析。 |
| `npm run build` | 生成 `dist/` 发布产物。 |

## Bench 与真实应用测试

### 空指针 Bench

`test:nullness:bench` 使用 `ArkDefectBench/Null Pointer Dereference/null_pointer_expected.json` 中的标注运行空指针测试，并汇总每个用例的 TP、FP、TN、FN，以及整体 Recall 和 Accuracy：

```bash
# 运行全部 Bench 用例
npm run test:nullness:bench

# 只运行一个用例；支持完整 id 或末尾用例名
npm run test:nullness:bench -- --case DirectNull

# 使用 M1 Hierarchical 生命周期模型运行全部用例
npm run test:nullness:bench -- --model hierarchical
```

Bench 用于衡量已有标注上的诊断精度，不生成持久化报告。存在 FP、FN、超时或执行错误时命令返回非零状态。`--` 用于把后面的参数传递给测试脚本。

### 生命周期建模 Bench

`test:lifecycle:benchmark` 使用 `ArkDefectBench/Lifecycle Modeling/lifecycle_model_expected.json` 比较生命周期模型保留或删除的路径。当前执行 M0 Flat 和 M1 Hierarchical；M2 的预期作为后续实现的验收契约。

```bash
npm run test:lifecycle:benchmark
```

实验步骤与实际结果分别记录在 [实验说明](docs/第一阶段实验/controlled_lifecycle_benchmark.md) 和 [实验结果](docs/第一阶段实验/controlled_lifecycle_benchmark_results.md)。

### 真实应用测试

真实应用脚本从 `HarmonyRealApps/meta.json` 读取工程清单。可以先查看可用项目：

```bash
npm run test:nullness:real-apps -- --list
npm run test:resource:real-apps -- --list
```

建议先选择单个项目或使用 `--limit` 小批量运行，并显式保存 JSON 报告：

```bash
# 单个项目的空指针分析；默认每个项目限时 600 秒
npm run test:nullness:real-apps -- \
  --project AnimeZ \
  --lifecycle-model flat \
  --ifds-stats \
  --timeout-ms 600000 \
  --output out/nullness-real-apps.json

# 前 5 个项目的资源泄漏分析；默认每个项目硬限时 180 秒
npm run test:resource:real-apps -- \
  --limit 5 \
  --lifecycle-model hierarchical \
  --ifds-stats \
  --timeout-ms 180000 \
  --output out/resource-real-apps.json
```

`--project` 可以重复传入；未指定 `--project` 和 `--limit` 时会分析清单中的全部项目。两个脚本都将每个工程放在独立进程中运行，逐项目记录成功、失败、超时、耗时和峰值内存，并增量写入报告；只要存在失败或超时，最终命令就返回非零状态。

常用参数如下：

| 参数 | 空指针真实应用 | 资源泄漏真实应用 | 作用 |
|---|---:|---:|---|
| `--project <name>` | 支持 | 支持 | 选择一个项目，可重复使用。 |
| `--limit <n>` | 支持 | 支持 | 只分析所选清单的前 n 个项目。 |
| `--output <file>` | 支持 | 支持 | 保存增量 JSON 报告。 |
| `--timeout-ms <n>` | 默认 600000 | 默认 180000 | 单项目硬超时。 |
| `--sdk-root <path>` | 支持 | 支持 | 指定 ETS SDK 根目录。 |
| `--max-access-path-length <n>` | 默认 5 | 不适用 | 空指针访问路径长度上限。 |
| `--max-abilities-per-flow <n>` | 不适用 | 默认 0（关闭） | 可选的资源流 Ability 上限，不属于 M0/M1。 |
| `--max-navigation-hops <n>` | 不适用 | 默认 0（关闭） | 可选的资源流导航跳数上限，不属于 M0/M1。 |
| `--max-propagation-depth <n>` | 默认 40 | 默认 40 | Fact 传播深度上限。 |
| `--lifecycle-model <mode>` | 默认 `flat` | 默认 `flat` | 选择 `flat` 或 `hierarchical` 生命周期模型。 |
| `--ifds-stats` | 支持 | 支持 | 在报告中保存 IFDS 求解时间和传播统计。 |
| `--lifecycle-root-only` | 支持 | 不适用 | 空指针实验仅运行生命周期 DummyMain root，关闭 supplemental roots。 |

真实应用集合的下载、版本固定和 `meta.json` 维护方式见 [HarmonyRealApps/README.md](./HarmonyRealApps/README.md)。完整参数可使用对应命令的 `--help` 查看。

## 使用边界

- 输入应为可读取的 HarmonyOS/OpenHarmony ArkTS 源码工程，而不是 `.hap` 或 `.app` 安装包。
- 检测结果是基于当前 IR、生命周期模型、规则和有界参数得到的候选问题，仍需结合业务语义人工确认。
- 零报告表示在当前分析边界内未发现候选问题，不代表工程不存在相关风险。
- 关闭类型推断、UI 回调或导航分析可能降低覆盖范围；正式分析前应确认报告中的 `warnings`、`errors` 和 `boundEnforcement`。
