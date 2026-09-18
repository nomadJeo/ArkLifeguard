# Controlled Lifecycle Benchmark 实验结果

## 1. 本次运行范围

- 日期：2026-09-18
- 已实现并运行：M0 Flat
- 尚未实现、未运行：M1 Hierarchical、M2 Hierarchical + Local FSM
- 执行入口：`npm run test:lifecycle:benchmark`
- 样例来源：`ArkDefectBench/Lifecycle Modeling/`

因此，下面的 M1、M2 case 只表示“当前 M0 是否表现出预期的过近似”，不能作为 M1、M2 已达到目标的证据。

## 2. M0 实际观测

| Case | 人工语义 | M0 应保留路径 | M0 实际观测 | 结果 |
| --- | --- | ---: | ---: | --- |
| `M0.PageVisibleEvent` | 可发生 | 是 | 是 | 通过 |
| `M0.MountedComponentEvent` | 可发生 | 是 | 是 | 通过 |
| `M0.ComponentDestroyedBoundary` | 不可发生 | 否 | 否 | 通过 |
| `M0.LegalForegroundReentry` | 可发生 | 是 | 是 | 通过 |
| `M0.AbilityDestroyedBoundary` | 不可发生 | 否 | 否 | 通过 |
| `M0.WindowDestroyedBoundary` | 不可发生 | 否 | 否 | 通过 |
| `M0.LegalPageReentryPreservation` | 可发生 | 是 | 是 | 通过 |
| `M0.LegalForegroundReentryPreservation` | 可发生 | 是 | 是 | 通过 |
| `M1.PageHiddenEvent` | 不可发生 | 是 | 是 | 通过，确认 M0 过近似 |
| `M1.AbilityBackgroundEvent` | 不可发生 | 是 | 是 | 通过，确认 M0 过近似 |
| `M2.RepeatedPageShow` | 不可发生 | 是 | 是 | 通过，确认 M0 过近似 |
| `M2.RepeatedForeground` | 不可发生 | 是 | 是 | 通过，确认 M0 过近似 |

## 3. 结果解释

当前 M0 对 8 个边界或合法路径 case 的处理与人工语义一致，说明后续模型需要保留这些行为。

M0 同时保留了 4 条人工判定为不可发生的路径：

- `onPageHide → handleClick`；
- `onBackground → handleClick`；
- `onPageShow → onPageShow`；
- `onForeground → onForeground`。

前两条用于观察 M1 的层次作用域收益，后两条用于观察 M2 的局部状态机收益。当前结果证明这些区分点在 M0 中确实存在，但尚未证明 M1、M2 能删除它们。

## 4. 测试状态

本次运行结果：

- 测试文件：1 个，通过 1 个；
- 测试项：24 个，通过 24 个；
- 其中 12 个检查 oracle 的递进关系，12 个执行 M0 实际观测；
- Vitest 报告总耗时：2.62 秒；
- `tsc -p tsconfig.test.json --noEmit`：通过。

实现 M1 或 M2 后，应在本文件追加对应模型的独立运行结果，不能用 oracle 中的预期值代替实际结果。
