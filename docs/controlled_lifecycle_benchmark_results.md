# Controlled Lifecycle Benchmark 实验结果

## 1. 本次运行范围

- 日期：2026-09-18
- 已实现并运行：M0 Flat、M1 Hierarchical
- 尚未实现、未运行：M2 Hierarchical + Local FSM
- Controlled suite：`npm run test:lifecycle:benchmark`
- 空指针 suite M0：`npm run test:nullness:bench -- --model flat`
- 空指针 suite M1：`npm run test:nullness:bench -- --model hierarchical`

两种模型使用相同的 ArkTS 项目、Scene 构造、空指针分析、IFDS solver 和 oracle。变量只有 lifecycle model。

## 2. Controlled suite 逐项结果

“保留”表示模型中存在被检查的路径；“删除”表示模型排除了该路径。

| Case | 人工语义 | M0 实际 | M1 实际 | 结论 |
| --- | --- | --- | --- | --- |
| `M0.PageVisibleEvent` | 可发生 | 保留 | 保留 | 真实路径未丢失 |
| `M0.MountedComponentEvent` | 可发生 | 保留 | 保留 | 真实路径未丢失 |
| `M0.ComponentDestroyedBoundary` | 不可发生 | 删除 | 删除 | 原有边界保持 |
| `M0.LegalForegroundReentry` | 可发生 | 保留 | 保留 | 合法重入未丢失 |
| `M0.AbilityDestroyedBoundary` | 不可发生 | 删除 | 删除 | 原有边界保持 |
| `M0.WindowDestroyedBoundary` | 不可发生 | 删除 | 删除 | 原有边界保持 |
| `M0.LegalPageReentryPreservation` | 可发生 | 保留 | 保留 | 合法重入未丢失 |
| `M0.LegalForegroundReentryPreservation` | 可发生 | 保留 | 保留 | 合法重入未丢失 |
| `M1.PageHiddenEvent` | 不可发生 | **错误保留** | **删除** | M1 修复 |
| `M1.AbilityBackgroundEvent` | 不可发生 | **错误保留** | **删除** | M1 修复 |
| `M2.RepeatedPageShow` | 不可发生 | 错误保留 | 错误保留 | 等待 M2 |
| `M2.RepeatedForeground` | 不可发生 | 错误保留 | 错误保留 | 等待 M2 |

测试结果为 36/36 通过，Vitest 总耗时 4.16 秒。其中 12 项验证 oracle 递进关系，12 项执行 M0，12 项执行 M1。

## 3. Controlled suite 精度变化

把“真实可发生且模型保留”记为 TP，把“真实不可发生但模型保留”记为 FP：

| 模型 | TP | FP | TN | FN | Precision | Recall | Accuracy |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| M0 Flat | 5 | 4 | 3 | 0 | 55.56% | 100.00% | 66.67% |
| M1 Hierarchical | 5 | 2 | 5 | 0 | 71.43% | 100.00% | 83.33% |

M1 删除了 2 条跨层非法路径，没有删除 5 条真实路径。路径级 Precision 提升 15.87 个百分点，Accuracy 提升 16.66 个百分点，Recall 保持 100%。

剩余 2 个 FP 是连续 `onPageShow` 和连续 `onForeground`。这两项属于同层回调顺序，按实验设计应由 M2 处理。它们在 M1 中继续存在，说明当前实现没有把 M2 的局部状态约束提前混入 M1。

## 4. ArkDefectBench 空指针套件

`Null Pointer Dereference/` 的 66 个程序在 M0、M1 下得到相同结果：

| 模型 | TP | FP | TN | FN | Precision | Recall | Accuracy |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| M0 Flat | 51 | 0 | 14 | 1 | 100.00% | 98.08% | 98.48% |
| M1 Hierarchical | 51 | 0 | 14 | 1 | 100.00% | 98.08% | 98.48% |

两次运行均为 65/66 case 通过。唯一失败都是既有的 `Callback.EventListener` 漏报，与生命周期模型无关。

这组套件没有观察到 M1 的总体指标提升，因为它在 M0 下已经没有 FP，无法度量“删除生命周期过近似路径”带来的收益。M1 也没有新增 FN，说明在这 66 个用例覆盖的能力范围内没有精度回归。

## 5. 结论边界

Controlled suite 支持以下结论：M1 在刻意控制的跨层生命周期场景中提高了路径保留精度，并保持已覆盖真实路径的召回。

当前结果不能说明 M1 已经提高真实应用上的总体精度。通用空指针套件对 M1 不敏感，而真实应用尚未运行带人工 ground truth 的对照实验。

M0/M1 在 48 个真实应用上的单轮资源分析性能对照已经完成，结果见 [M1 RealApps 性能结果](m1_realapps_performance_results.md)。关闭 callback/Ability/navigation K-bound 后，IFDS 时间变化为 -0.27%，同时传播工作量略增，不能据此认定 M1 带来性能提升。
