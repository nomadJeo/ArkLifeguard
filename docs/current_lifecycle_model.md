# 当前生命周期模型（M0 Flat）

## 结论

当前 `FlatLifecycleModelCreator`（原 `BackEdgeLifecycleModelCreator`）就是 RQ1 第一阶段的 M0 Flat Baseline。`back-edge` 描述了 CFG 的实现机制，`flat` 描述了实验变量，因此对外配置和默认值改为 `flat` 更准确；旧的 `back-edge` 配置与类名仍作为兼容别名保留。

该模型与 HomeFlow 的生命周期入口在总体思路和主要 CFG 结构上保持一致。HomeFlow 在 `src/run.ts` 中直接创建 ArkAnalyzer 的 `DummyMainCreater`，并把生成的 DummyMain 作为分析入口。ArkAnalyzer 的生成结构同样是：

```text
创建实例
→ Ability onCreate / onWindowStageCreate
→ Component aboutToAppear
→ 全局非确定循环
     ├─ Ability 普通生命周期 callback
     ├─ Page / Component callback
     └─ UI event callback
→ Component aboutToDisappear
→ WindowStage / Ability destroy callback
→ return
```

ArkLifeguard 的 M0 在回调收集范围、ViewTree UI callback 提取和参数构造上有自己的扩展，因此不能称为 HomeFlow 实现的逐行复制；但“启动回调在循环前、普通生命周期和事件回调共享一个全局循环、结束回调在循环后”的核心建模方式一致。

## 生成与调用入口

- `src/lifecycle/BackEdgeLifecycleModelCreator.ts` 构造 M0 DummyMain。公开实现名为 `FlatLifecycleModelCreator`。
- `src/lifecycle/LifecycleModelEntry.ts` 负责模型选择。默认配置是 `flat`；`back-edge` 映射到同一实现。
- `src/application/ProjectAnalyzer.ts` 在统一分析入口中构造生命周期模型，再把同一个 DummyMain 交给资源分析和空指针分析。
- `src/analysis/nullness/NullnessAnalysisRunner.ts` 和 `src/analysis/resource/TaintAnalysisSolver.ts` 也支持直接从所选模型生成的 DummyMain 开始分析。
- ICFG 由 `ArkInterproceduralCFG` 提供，IFDS 求解入口是 `DataflowSolver.solve()`；M0 没有修改 solver 或 fact 域。

## 当前 M0 的 CFG

M0 是有限大小、有环的 CFG。入口块创建 Ability/Component 实例，并顺序调用启动阶段；中间用一组非确定分支表示所有普通生命周期 callback 和 UI callback，每条分支都回到同一个循环头；循环头也可以退出到结束块。

```text
entry(create / window-create / appear)
  ↓
global loop head ───────────────→ end(disappear / window-destroy / destroy)
  ↓                                    ↓
callback branch ──→ callback call      return
  ↑                    │
  └────────────────────┘
```

因此，M0 允许 `onPageHide → onClick`、`onBackground → onClick` 等循环内任意组合，也允许 callback 无限重复。它不允许 `aboutToDisappear → onClick`、`onWindowStageDestroy → onPageShow` 或 `onDestroy → onForeground`，因为这些结束回调位于退出块，退出后没有回到全局循环的边。

这个边界与任务说明中的简化示意略有差异。Controlled Benchmark 必须以实际 CFG 为准：前三类 transition 能用于观察 Flat 的过近似，后三类在当前 M0 中已经被删除，不能用来夸大 M1/M2 的收益。

## Callback 如何加入

- Ability 启动阶段：`onCreate`、`onWindowStageCreate` 在入口块中顺序调用。
- Ability 循环阶段：`lifecycleOrder` 中除启动和结束阶段外的方法各自成为全局循环的一个分支。
- Ability 结束阶段：`onWindowStageWillDestroy`、`onWindowStageDestroy`、`onDestroy` 在结束块中顺序调用。
- Component 启动和结束阶段：`aboutToAppear` 在入口块，`aboutToDisappear` 在结束块。
- Page/Component 循环阶段：`build`、`onPageShow`、`onPageHide`、按键/返回等 callback 各自成为循环分支。
- UI event：从 ViewTree 提取的 `onClick`、`onChange` 等 callback 也成为同一个循环中的独立分支。

M0 没有 Ability → WindowStage → Page → Component 的嵌套 lifetime scope，也没有局部生命周期状态机。除启动/结束边界外，所有被收集到循环中的 callback 共用一个 global loop。

## 与 HomeFlow 的核对边界

本次核对依据是 HomeFlow 当前源码中的 `new DummyMainCreater(..., true)` 调用、其 `arkanalyzer` 依赖声明，以及本地 ArkAnalyzer `DummyMainCreater` 源码。HomeFlow 声明 `arkanalyzer ^1.0.91`，当前 ArkLifeguard 安装的是 `1.0.90`；两者的具体依赖解析版本未由 HomeFlow lockfile 固定。因此可以确认建模思路和调用入口一致，并确认本地相邻版本的 CFG 结构一致，但不把它表述为所有版本逐行完全相同。

## 本阶段明确未做

## M1 Hierarchical 模型

M1 已通过 `lifecycleModel = hierarchical` 提供。它把 M0 的全局循环拆成三层作用域：

```text
Ability dispatcher
  └─ Foreground entry
       └─ Page dispatcher
            └─ Page-show entry
                 └─ Visible UI-event dispatcher
```

`onBackground` 或 `onPageHide` 返回外层作用域；再次执行 UI callback 前必须重新经过 `onForeground` 和 `onPageShow`。每层内部仍允许非确定重复，因此连续 `onForeground` 和连续 `onPageShow` 仍然存在，留给 M2 的局部状态机处理。

M1 没有把生命周期状态加入 IFDS fact，也没有修改 IFDS solver。M2 Hierarchical + Local State Machines 尚未实现。
