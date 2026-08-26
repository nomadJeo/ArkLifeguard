# ArkLifeguard

ArkLifeguard 是面向 HarmonyOS/OpenHarmony ArkTS 应用的命令行静态分析工具。项目基于 ArkAnalyzer 构建程序 IR，通过有界生命周期模型和 IFDS 数据流分析，在不运行应用的情况下辅助发现空指针解引用与资源未释放问题。

> 项目的使用方式请阅读[QUICKSTART.md](./QUICKSTART.md)。

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
  --format json \
  --output out/report.json
```

默认同时运行资源泄漏分析和空指针分析。SDK 配置、真实工程要求、分析边界与报告解读见 [快速使用指南](./QUICKSTART.md)。

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
| `--max-callback-iterations` | 1 | 生命周期及 UI 回调序列的最大展开轮数。 |
| `--max-abilities-per-flow` | 3 | 单条资源流最多访问的 Ability 数量。 |
| `--max-navigation-hops` | 5 | 单条资源流最多经过的导航跳数。 |
| `--max-access-path-length` | 5 | 空指针访问路径的最大长度。 |
| `--max-propagation-depth` | 40 | 资源与空指针 Fact 的最大传播深度。 |

报告中的 `settings.bounds` 记录参数值，`settings.boundEnforcement` 说明参数在本次分析中是否实际生效。

## 常用开发命令

| 命令 | 用途 |
|---|---|
| `npm run typecheck` | 检查生产源码类型。 |
| `npm run typecheck:test` | 检查测试源码类型。 |
| `npm test` | 运行默认测试套件。 |
| `npm run test:lifecycle` | 运行生命周期建模测试。 |
| `npm run test:ifds` | 运行 IFDS 基础设施测试。 |
| `npm run test:resource` | 运行资源分析测试。 |
| `npm run test:nullness` | 运行空指针分析测试。 |
| `npm run test:cli` | 运行应用层、报告和 CLI 测试。 |
| `npm run build` | 生成 `dist/` 发布产物。 |

## 使用边界

- 输入应为可读取的 HarmonyOS/OpenHarmony ArkTS 源码工程，而不是 `.hap` 或 `.app` 安装包。
- 检测结果是基于当前 IR、生命周期模型、规则和有界参数得到的候选问题，仍需结合业务语义人工确认。
- 零报告表示在当前分析边界内未发现候选问题，不代表工程不存在相关风险。
- 关闭类型推断、UI 回调或导航分析可能降低覆盖范围；正式分析前应确认报告中的 `warnings`、`errors` 和 `boundEnforcement`。
