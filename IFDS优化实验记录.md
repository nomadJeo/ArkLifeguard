# IFDS 优化实验记录

本文档记录 IFDS 求解器优化的基线、实现、真实项目实验和去留结论。待优化事项仍维护在 [IFDS 迁移后待优化项](./IFDS迁移后待优化项.md)中。

## 实验约定

- 基线与优化版本使用相同项目、SDK、分析参数和 `--ifds-stats`。
- 首先核对诊断、传播尝试数和最终 PathEdge 数，再比较耗时与峰值 RSS。
- 单次运行只用于识别明显变化；小幅耗时差异不作为稳定性能收益证据。
- 开启统计会增加开发者观测开销，性能对比必须在相同统计配置下进行。
- 原始 JSON 报告保存在已忽略的 `out/` 或本地临时目录，本文档记录文件名和 SHA-256。

## 实验环境

| 项目 | 值 |
| --- | --- |
| 日期 | 2026-08-29 |
| 分支 | `feature/ifds-enhance` |
| Node.js | `v22.19.0` |
| ArkAnalyzer | `1.0.90` |
| SDK | `sdk/default` |
| 真实项目集 | `HarmonyRealApps` |

## 实验 1：使用双队列替换 laterEdges

### 目标

将原始 `workList + laterEdges` 替换为 immediate FIFO 和 deferred LIFO 双队列，保持“调用/返回边优先、normal-flow 边延后”的调度顺序，并消除重复 normal-flow Edge 对象在 `laterEdges` 中的残留。

### 版本

- 原始调度基线：`baf74ea feat(ifds): add opt-in solver statistics reports`
- 双队列实现：`0a86adf perf(ifds): replace later edges with two-tier queues`

### 项目与命令

项目：`KeePassHO`

```bash
npm run test:resource:real-apps -- \
  --project KeePassHO \
  --real-apps-root HarmonyRealApps \
  --sdk-root sdk/default \
  --timeout-ms 180000 \
  --ifds-stats \
  --output <report.json>
```

### 结果

| 指标 | 原始调度 | 双队列 | 变化 |
| --- | ---: | ---: | ---: |
| 总耗时 | 12,972 ms | 13,195 ms | +1.7% |
| 资源分析耗时 | 7,576 ms | 7,799 ms | +2.9% |
| IFDS 求解耗时 | 4,945 ms | 5,127 ms | +3.7% |
| 峰值 RSS | 517.62 MB | 519.86 MB | +0.4% |
| 传播尝试 | 31,416 | 31,416 | 0 |
| 最终 PathEdge | 27,989 | 27,989 | 0 |
| 重复 Edge | 3,427 | 3,427 | 0 |
| deferred 重复 Edge | 289 | 289 | 0 |
| 最大待处理队列 | 295 | 295 | 0 |
| `laterEdges` 峰值 | 558 | 0 | -558 |
| `laterEdges` 结束残留 | 289 | 0 | -289 |
| 跨过程资源泄漏 | 0 | 0 | 0 |
| 方法内资源候选 | 9 | 9 | 0 |

### 结论

双队列没有在本次单项目单次运行中体现耗时或 RSS 收益，不能将小幅变慢解释为稳定回归。优化在诊断、传播和 PathEdge 数量不变的前提下，明确消除了 289 个结束残留对象，因此保留作为求解器数据结构简化，不宣称性能提升。

### 原始报告

| 版本 | 本地文件 | SHA-256 |
| --- | --- | --- |
| 原始调度 | `/tmp/ifds-baseline-keepassho.json` | `e1acd25fd944301b0363d533af9a5dc224e97cb04de012c7eabd0f31a26ff8bb` |
| 双队列 | `/tmp/ifds-optimized-keepassho.json` | `d4d1a48cf8697fdac0ee6675aac191501eec6f0490fe6c3b7305f573da141d06` |

## 实验 2：PathEdge 线性去重基线

### 目标

量化 `pathEdgeSetHasEdge()` 扫描全部已有 PathEdge 和调用 `factEqual()` 的实际成本，为通用语义哈希索引建立可比较基线。

### 版本

- 双队列基础：`0a86adf perf(ifds): replace later edges with two-tier queues`
- 去重成本统计：`9c4911d feat(ifds): measure semantic deduplication cost`

新增开发者统计：

- `deduplicationLookups`
- `deduplicationCandidateChecks`
- `maxDeduplicationCandidates`
- `factEqualityChecks`

### 项目与命令

项目：`AnimeZ`、`harmony-utils`、`jingmo-for-HarmonyOS`、`KeePassHO`、`LinysBrowser_NEXT`。

```bash
npm run test:resource:real-apps -- \
  --project AnimeZ \
  --project harmony-utils \
  --project jingmo-for-HarmonyOS \
  --project KeePassHO \
  --project LinysBrowser_NEXT \
  --real-apps-root HarmonyRealApps \
  --sdk-root sdk/default \
  --timeout-ms 180000 \
  --ifds-stats \
  --output out/ifds-equality-baseline-real-apps.json
```

### 汇总结果

| 指标 | 结果 |
| --- | ---: |
| 选中项目 | 5 |
| 成功 / 失败 / 超时 | 5 / 0 / 0 |
| 跨过程资源泄漏 | 8 |
| 方法内资源候选 | 170 |
| IFDS 求解总耗时 | 122,389 ms |
| 平均总耗时 | 30,157 ms |
| 平均资源分析耗时 | 25,896 ms |
| 最大峰值 RSS | 531.55 MB |
| 传播尝试 | 193,553 |
| 最终 PathEdge | 171,905 |
| 重复 Edge | 21,648 |
| 去重查询 | 193,553 |
| 去重候选扫描 | 5,136,361,733 |
| `factEqual()` 调用 | 5,138,432,446 |
| 最大单次候选扫描 | 84,337 |
| 最大待处理队列 | 301 |

### 逐项目结果

| 项目 | IFDS 耗时 | PathEdge | 候选扫描 | 平均每次查询 | 最大扫描 |
| --- | ---: | ---: | ---: | ---: | ---: |
| AnimeZ | 758 ms | 9,897 | 54,959,255 | 4,763 | 9,896 |
| harmony-utils | 6,316 ms | 33,341 | 634,731,876 | 16,102 | 33,340 |
| jingmo-for-HarmonyOS | 1,486 ms | 16,340 | 145,524,865 | 7,916 | 16,339 |
| KeePassHO | 6,299 ms | 27,989 | 429,464,777 | 13,670 | 27,988 |
| LinysBrowser_NEXT | 107,530 ms | 84,338 | 3,871,680,960 | 41,723 | 84,337 |

### 分析

- 平均每次去重查询扫描约 26,537 个已有 Edge。
- `LinysBrowser_NEXT` 占全部候选扫描约 75.4%，占 IFDS 求解时间约 87.9%。
- 最大待处理队列只有 301，而最大去重扫描为 84,337，说明当前主要成本来自 PathEdge 全量线性去重，不是队列容量。
- 重复 Edge 仅占传播尝试约 11.2%，但新 Edge 和重复 Edge 都要扫描大量已有边，因此即使重复比例不高，总成本仍接近二次增长。

### 结论与下一步

当前统计已足以支持下一步实验。应引入通用 `factHash + factEqual` 哈希桶索引：先用 hash 缩小候选集，再在桶内使用 `factEqual` 防止哈希冲突。优化后使用同一组项目和同一组统计字段复测，并核对：

1. 诊断内容与数量不变。
2. `propagationAttempts`、`finalPathEdgeCount` 和 `duplicateEdgesSkipped` 不变。
3. `deduplicationCandidateChecks` 和 `factEqualityChecks` 显著降低。
4. IFDS 求解耗时和峰值 RSS 不回归。

### 原始报告

- 文件：`out/ifds-equality-baseline-real-apps.json`
- SHA-256：`72e0f4688f54f6b3cb11306ff6fe16570b85000ccaaf86c31d555f463c24f79e`

## 实验 3：PathEdge 语义哈希索引

### 目标

在 `DataflowProblem` 中增加兼容的 `factHash()` 契约，在通用 `DataflowSolver` 中建立 PathEdge 语义哈希索引，并将 NullnessSolver 原有的专用 Edge 索引迁移到通用框架。

### 版本

- 基线提交：`9c4911d feat(ifds): measure semantic deduplication cost`
- 优化提交：`0b1e9af perf(ifds): index path edges by semantic hash`

### 实现

- `DataflowProblem.factHash()` 默认返回 `0`，未适配的旧问题仍保持正确，但会退化为单桶。
- `NullnessProblem` 和 `TaintAnalysisProblem` 使用各自 Fact 的 `hashCode()`。
- PathEdge 按“起点 Stmt 身份 → 终点 Stmt 身份 → 起点 Fact hash → 终点 Fact hash”建立分层 Map。
- hash 只用于缩小候选集，桶内仍使用 `factEqual()` 防止哈希冲突导致错误去重。
- `computeResult()` 的 Fact 比较同步改为 `factEqual()`。
- NullnessSolver 删除了专用 `pathEdgeIndex`、Edge hash 和 Edge/Point 重复比较实现，复用通用 Solver 能力。

### 实现过程记录

最初尝试将四元组合并为一个 32 位整数 hash。该版本将 IFDS 总耗时降至 49,262 ms，但仍扫描 2,366,947,491 个候选，最大单桶为 66,636，说明线性组合 hash 存在系统性冲突。最终改为分层 Map，避免将 Stmt 身份和 Fact hash 压缩到同一整数。

中间报告：

- 文件：`out/ifds-equality-hash-index-real-apps.json`
- SHA-256：`a3e2b50df1fd9b65e38a2a33adc83125d610363f0545539f00cc29f7c6ca2aca`

### 项目与命令

与实验 2 使用完全相同的五个真实项目和分析参数，仅将输出改为：

```text
out/ifds-equality-hash-index-final-real-apps.json
```

### 汇总结果

| 指标 | 线性扫描 | 分层 hash 索引 | 变化 |
| --- | ---: | ---: | ---: |
| IFDS 求解总耗时 | 122,389 ms | 7,016 ms | -94.3% |
| 平均总耗时 | 30,157 ms | 7,011 ms | -76.8% |
| 平均资源分析耗时 | 25,896 ms | 2,842 ms | -89.0% |
| 平均峰值 RSS | 465 MB | 455 MB | -2.2% |
| 最大峰值 RSS | 531.55 MB | 535.05 MB | +0.7% |
| 传播尝试 | 193,553 | 193,553 | 0 |
| 最终 PathEdge | 171,905 | 171,905 | 0 |
| 重复 Edge | 21,648 | 21,648 | 0 |
| 去重候选扫描 | 5,136,361,733 | 25,588 | -99.9995% |
| `factEqual()` 调用 | 5,138,432,446 | 47,236 | -99.9991% |
| 最大单次候选扫描 | 84,337 | 58 | -99.93% |
| 最大待处理队列 | 301 | 301 | 0 |

### 逐项目结果

| 项目 | 基线 IFDS | 优化后 IFDS | 变化 | 基线候选扫描 | 优化后候选扫描 |
| --- | ---: | ---: | ---: | ---: | ---: |
| AnimeZ | 758 ms | 369 ms | -51.3% | 54,959,255 | 1,913 |
| harmony-utils | 6,316 ms | 1,483 ms | -76.5% | 634,731,876 | 6,079 |
| jingmo-for-HarmonyOS | 1,486 ms | 535 ms | -64.0% | 145,524,865 | 2,043 |
| KeePassHO | 6,299 ms | 1,190 ms | -81.1% | 429,464,777 | 3,427 |
| LinysBrowser_NEXT | 107,530 ms | 3,439 ms | -96.8% | 3,871,680,960 | 12,126 |

### 正确性核对

- 五个真实项目的跨过程资源泄漏、污点泄漏和方法内候选记录逐项一致。
- `propagationAttempts`、`uniqueEdgesEnqueued`、`duplicateEdgesSkipped`、`processedEdges` 和 `finalPathEdgeCount` 一致。
- IFDS 语义相等与 hash 冲突测试通过：语义相同的不同 Fact 实例被去重，相同 hash 的不同 Fact 不会被误删。
- TypeScript 源码、测试和脚本类型检查通过。
- IFDS、Nullness、资源、CLI 和报告聚焦回归：20 个文件、166 个测试通过。
- ArkDefectBench 保持 TP=37、TN=12、FP=0、FN=3（49/52）；三个既有漏报仍为 ExceptionPath、HideShow 和 EventListener。

### 结论

优化在诊断和 IFDS 传播结果不变的前提下，大幅降低了去重扫描和求解时间，效果在五个项目上一致，应保留。平均峰值 RSS 略有下降，但最大单项目 RSS 从 531.55 MB 增加到 535.05 MB，因此不宣称稳定的内存收益。

### 原始报告

- 文件：`out/ifds-equality-hash-index-final-real-apps.json`
- SHA-256：`e88f3733b70cf5e845991ce2fa340d3fe8436f62a26c3bec31c4303a5fc88eeb`

## 实验 4：抽取 PathEdge 存储与 Summary 管理

### 目标

将 PathEdge 存储、语义去重索引从 `DataflowSolver` 抽取为 `PathEdgeStore`，将 incoming edge、end summary 和 call summary 统一抽取为 `SummaryStore`，并让通用 Solver 与 NullnessSolver 共用同一套语义等价与 hash 契约。

### 版本

- 结构基线：`dd4f021 docs(ifds): record solver optimization experiments`
- 抽取实现：`5b1f552 refactor(ifds): extract edge and summary stores`

### 实现

- `PathEdgeStore` 负责 Edge 存储、分层 hash 索引、冲突安全的语义去重与去重统计。
- `SummaryStore` 按 Stmt 身份与 Fact 语义管理 incoming、end summary 和 call summary。
- `DataflowSolver` 仅保留求解流程与调度；`NullnessSolver` 删除自有的 incoming、end-summary 和 call-summary 索引。
- incoming 保存完整 caller PathEdge，返回传播时不再扫描全部 PathEdge 反查 caller 起点。

### 最小验证

- TypeScript 源码、测试与脚本类型检查通过。
- IFDS store 的语义去重、hash 冲突、incoming、end summary 和 call summary 单元测试通过：2 个文件、7 个测试。
- IFDS、Nullness、资源、CLI 和报告聚焦回归通过：21 个文件、168 个测试。
- ArkDefectBench 保持 TP=37、TN=12、FP=0、FN=3（49/52），与抽取前基线一致。
- 真实项目只运行 `KeePassHO` 单项目单次实验，用于发现语义或明显性能回归。

### KeePassHO 结果

| 指标 | 抽取前 | 抽取后 | 变化 |
| --- | ---: | ---: | ---: |
| 总耗时 | 9,206 ms | 8,833 ms | -4.1% |
| 资源分析耗时 | 3,859 ms | 3,465 ms | -10.2% |
| IFDS 求解耗时 | 1,190 ms | 910 ms | -23.5% |
| 峰值 RSS | 535.05 MB | 498.21 MB | -6.9% |
| 传播尝试 | 31,416 | 31,098 | -318 |
| 重复 Edge | 3,427 | 3,109 | -318 |
| 唯一 / 处理 / 最终 PathEdge | 27,989 | 27,989 | 0 |
| 跨过程资源泄漏 | 0 | 0 | 0 |
| 方法内资源候选 | 9 | 9 | 0 |

诊断记录逐项一致。传播尝试减少 318 次，是因为 call summary 改为语义去重后，消除了旧实现按 `PathEdgePoint`/Fact 对象身份判断产生的重复传播；唯一 Edge 与最终结果不变。

### 结论

抽取后的责任边界更清晰，通用和 Nullness Solver 的摘要语义已统一，聚焦测试与单项目诊断均未回归，因此保留。单次 KeePassHO 运行未发现明显性能回归，但不将本次耗时和 RSS 下降宣称为稳定性能收益。

### 原始报告

- 文件：`out/ifds-store-extraction-keepassho.json`
- SHA-256：`eede4bf6a41106812a04d4f786301c9ac823a9717704a0fae3bf02f1f60d17f3`

## 实验 5：将新 Summary 应用到全部已有 Caller

### 目标

补齐 IFDS 摘要传播的双向时序：`processCallNode` 负责将已有 summary 重放给新 caller，`processExitNode` 负责将新 summary 应用给全部已登记的语义匹配 caller context。本次不跳过 call flow 或 call-to-return flow。

### 是否增加统计

不增加永久运行时统计。该问题是可由最小双 caller 用例确定的正确性缺口，不需要通过真实项目命中率决定是否修复。现有的传播、唯一 Edge 和重复 Edge 统计足以检查性能影响。

### 修复前复现

定向用例预先登记两条语义相同调用点、不同起始 Fact 的 caller PathEdge：

```text
(callerEntry, CONTEXT_1) -> (callSite, CALL_INPUT)
(callerEntry, CONTEXT_2) -> (callSite, CALL_INPUT)
```

产生新 summary 后，修复前实际只得到 `CONTEXT_1`，期望的 `CONTEXT_2` 返回 PathEdge 缺失，定向测试稳定失败。

### 实现

- 提供通用 `applySummaryToIncomingCallers()`，只遍历当前 callee-entry Fact 的 `Incoming` 集合，不扫描全部 PathEdge。
- 使用 Stmt 身份和 `factEqual()` 筛选与 summary call point 语义匹配的 caller。
- `addCallSummary()` 的新增结果只用于决定是否启动一次 apply-to-all，不再将传播限制在第一条 caller Edge。
- NullnessSolver 共用通用实现。

### 验证

- 修复提交：`569bfba fix(ifds): apply summaries to all caller contexts`
- 双 caller 定向回归修复后通过。
- TypeScript 源码、测试和脚本类型检查通过。
- IFDS、Nullness、资源、CLI 和报告聚焦回归：21 个文件、169 个测试通过。
- ArkDefectBench 保持 TP=37、TN=12、FP=0、FN=3（49/52）。
- KeePassHO 诊断逐项一致；传播尝试 31,098、唯一/最终 PathEdge 27,989，与修复前相同，说明该项目未触发双 caller 缺口。单次 IFDS 求解耗时为 903 ms，未见明显回归。

### 扩展真实项目对照

为检查更大项目上的性能影响，使用修复前提交 `5b1f552` 和修复后提交 `569bfba` 分别运行 `AnimeZ`、`harmony-utils` 和 `LinysBrowser_NEXT`。两次运行共用同一份项目集、SDK、依赖和分析参数。

| 项目 | 修复前 IFDS | 修复后 IFDS | 变化 | PathEdge 是否一致 |
| --- | ---: | ---: | ---: | --- |
| AnimeZ | 311 ms | 331 ms | +6.4% | 是（9,897） |
| harmony-utils | 1,037 ms | 1,010 ms | -2.6% | 是（33,341） |
| LinysBrowser_NEXT | 2,443 ms | 2,326 ms | -4.8% | 是（84,338） |
| 合计 | 3,791 ms | 3,667 ms | -3.3% | 是（127,576） |

三个项目的诊断均逐项一致，传播尝试合计均为 143,467，重复 Edge 合计均为 15,891。这说明它们也没有触发可观测的多 caller 补传播。合计耗时下降 3.3%，但 `AnimeZ` 单项目反而增加 6.4%，单次结果不具有一致性，因此不能证明该修复带来稳定性能提升。

### 结论

保留修复。正确性缺口已由最小用例复现并关闭，真实项目单次运行未发现语义或性能回归。不将本次改动解释为 flow 缓存优化。

### 原始报告

- 文件：`out/ifds-summary-existing-callers-keepassho.json`
- SHA-256：`f76b75d26b922dee552f9509015f9544c9f99e3e441f7ac7635615c5b3b7cac4`
- 三项目修复前：`/tmp/ifds-summary-callers-baseline-3projects.json`
- 修复前 SHA-256：`ca64f264565403f7a12c0ad773e1fc9778b142de6962f46d8375d5d00ca5c453`
- 三项目修复后：`out/ifds-summary-callers-fixed-3projects.json`
- 修复后 SHA-256：`1eb2ca7f5a4bf15b71c262ef834208af5f72a3b3d52059092079c1268da77301`

## 后续实验模板

```markdown
## 实验 N：优化名称

### 目标

### 版本

- 基线提交：
- 优化提交：

### 项目与命令

### 结果

### 正确性核对

### 结论

- 保留 / 继续观察 / 回退

### 原始报告
```
