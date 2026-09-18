# Controlled Lifecycle Benchmark 实验说明

## 1. 这个实验要回答什么

我们要比较三种生命周期模型能否排除不可能发生的回调顺序，同时保留真实可能发生的顺序：

- **M0 Flat**：所有活动期回调共用一个全局循环；
- **M1 Hierarchical**：增加 Ability、Page、Component 等生命周期作用域；
- **M2 Hierarchical + Local FSM**：在 M1 上继续限制同一作用域内的回调顺序。

当前已经实现并运行 M0、M1。M2 的预期写进 oracle，是以后实现 M2 时必须通过的验收条件，不表示 M2 已经运行。

实际运行结果单独记录在 [controlled_lifecycle_benchmark_results.md](controlled_lifecycle_benchmark_results.md)。

## 2. 样例放在哪里

Benchmark 已并入 ArkDefectBench：

```text
ArkDefectBench/Lifecycle Modeling/
├── AbilityReentry/
├── AbilityStateOrder/
├── ComponentLifetime/
├── PageStateOrder/
├── PageVisibility/
├── WindowStage/
└── lifecycle_model_expected.json
```

`lifecycle_model_expected.json` 是唯一的模型预期表。测试代码从该文件加载样例，不在测试中重复维护一份预期。

它没有放进 `Null Pointer Dereference/null_pointer_expected.json`。后者判断程序语义上是否真的存在空指针；本实验还需要记录 M0、M1、M2 是否会保留同一条路径，两种 oracle 的含义不同。

## 3. 一个样例怎样判断对错

每个 case 先给出人工语义答案：

- `semanticFeasible: true`：这个回调顺序在真实生命周期中可能发生，模型应保留；
- `semanticFeasible: false`：这个回调顺序不可能发生，模型应删除。

再给出 `firstPreciseModel`：

- `M0`：Flat 已经能正确处理，M1、M2 也必须继续正确；
- `M1`：M0 会多保留这条路径，加入层次作用域后应删除；
- `M2`：M0、M1 都会多保留，加入局部状态机后才应删除。

oracle 中的 `expected` 表示模型是否应保留路径。`true` 是保留，`false` 是删除。它不是“程序是否有 bug”的标签。

## 4. 怎样观察一条路径

实验使用两种观察方式。

### 4.1 空指针诊断

大多数 case 在前一个回调中把字段置为 `null`，在后一个回调中解引用：

```text
source callback:      resource = null
                              ↓
target callback:      resource.use()
```

若分析报告这对 source 和 dereference，说明生命周期模型保留了这条回调路径。测试按两条语句的原始文本配对，不用诊断总数代替路径判断。

### 4.2 直接检查 CFG transition

WindowStage 和 Page 属于不同实例，使用共享静态字段会额外引入全局状态语义。因此 `WindowDestroyedBoundary` 和 `AbilityBackgroundEvent` 直接检查：离开 source callback 后，下一个 callback 能否立即到达 target callback。

这里检查“下一个 callback”，不是普通的传递可达。例如 M1 应删除 `onBackground → handleClick` 的直接跳转，但仍可以保留合法的 `onBackground → onForeground → onPageShow → handleClick`。

## 5. 样例分组

| 首次正确模型 | Case | 被检查的顺序 | 人工语义 | 观察方式 |
| --- | --- | --- | --- | --- |
| M0 | `PageVisibleEvent` | `onPageShow → handleClick` | 可发生 | 空指针 |
| M0 | `MountedComponentEvent` | `aboutToAppear → handleClick` | 可发生 | 空指针 |
| M0 | `ComponentDestroyedBoundary` | `aboutToDisappear → handleClick` | 不可发生 | 空指针 |
| M0 | `LegalForegroundReentry` | `onBackground → onForeground` | 可发生 | 空指针 |
| M0 | `AbilityDestroyedBoundary` | `onDestroy → onForeground` | 不可发生 | 空指针 |
| M0 | `WindowDestroyedBoundary` | `onWindowStageDestroy → onPageShow` | 不可发生 | CFG transition |
| M0 | `LegalPageReentryPreservation` | `onPageHide → onPageShow` | 可发生 | 空指针 |
| M0 | `LegalForegroundReentryPreservation` | `onBackground → onForeground` | 可发生 | 空指针 |
| M1 | `PageHiddenEvent` | `onPageHide → handleClick` | 不可发生 | 空指针 |
| M1 | `AbilityBackgroundEvent` | `onBackground → handleClick` | 不可发生 | CFG transition |
| M2 | `RepeatedPageShow` | `onPageShow → onPageShow` | 不可发生 | 空指针 |
| M2 | `RepeatedForeground` | `onForeground → onForeground` | 不可发生 | 空指针 |

M2 的两个项目同时包含合法重入 control。这样可以区分“正确限制连续重复回调”和“简单删除所有循环”。

## 6. 运行当前实验

```bash
npm run test:lifecycle:benchmark
```

这条命令只运行 controlled lifecycle benchmark，不运行完整测试套件、全量构建、真实应用实验或耗时基准。

当前测试执行三项检查：

1. 验证 oracle 的 M0 → M1 → M2 递进关系没有写反；
2. 用当前 M0 Flat 运行 12 个观察项，并与 oracle 的 `flat` 列比较。
3. 用当前 M1 Hierarchical 运行同样的 12 个观察项，并与 oracle 的 `hierarchical` 列比较。

## 7. 实现 M1、M2 后怎样复用

实现 M2 后，让同一批项目继续使用 `hierarchical-state`，并与已经运行的 `flat`、`hierarchical` 结果比较。Scene、调用图、空指针分析和 IFDS 配置必须保持不变。验收条件是：

1. 8 个 M0 case 在三个模型中都正确；
2. 2 个 M1 case 从 M1 开始删除；
3. 2 个 M2 case 从 M2 开始删除；
4. 两条合法重入 control 在 M2 中仍被保留。

如果观测与 oracle 冲突，应先复查真实生命周期语义和通用 CFG 生成规则，不为单个 benchmark case 加特殊分支。
