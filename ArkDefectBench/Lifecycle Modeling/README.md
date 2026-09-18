# Lifecycle Modeling Controlled Benchmark

本目录保存 RQ1 生命周期建模实验的项目源码和模型 oracle。

- `lifecycle_model_expected.json`：12 个观察项对 M0、M1、M2 的预期；
- 六个项目目录：能够被 ArkAnalyzer 分别构建的最小 ArkTS 场景；
- 测试入口：`npm run test:lifecycle:benchmark`。

实验设计见 [实验说明](../../docs/第一阶段实验/controlled_lifecycle_benchmark.md)，已经运行的结果见 [实验结果](../../docs/第一阶段实验/controlled_lifecycle_benchmark_results.md)。

这里的 `expected` 表示模型是否保留一条路径。它与 `Null Pointer Dereference/null_pointer_expected.json` 中的 `expected.bug` 含义不同。当前测试实际运行 M0 和 M1；M2 仍是未来契约。
