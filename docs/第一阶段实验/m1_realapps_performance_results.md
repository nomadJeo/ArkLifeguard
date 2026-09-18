# M1 RealApps 性能结果

## 1. 实验范围

- 日期：2026-09-18
- 对象：`HarmonyRealApps/meta.json` 中全部 48 个项目
- 分析：资源泄漏分析，开启 IFDS 聚合统计
- 对照：M0 Flat 与 M1 Hierarchical
- 运行方式：每个“项目 × 模型”在独立冷进程中执行
- 重复次数：每个配置 1 次
- 生命周期 K-bound：关闭；不设置 callback iteration，Ability/Navigation 预算均为 0（不限制）

两组除生命周期模型外使用相同的项目、SDK、分析参数和超时设置。`maxPropagationDepth=40` 是两组共同的 IFDS 传播安全阈值，不是生命周期模型的 K-bound。本次是单轮配对测量，用于判断变化量级；没有多轮交替运行，因此不提供方差或稳定加速结论。

## 2. 运行命令

```bash
npm run test:resource:real-apps -- \
  --lifecycle-model flat \
  --timeout-ms 180000 \
  --max-propagation-depth 40 \
  --ifds-stats \
  --output out/lifecycle-m0-resource-real-apps-unbounded.json

npm run test:resource:real-apps -- \
  --lifecycle-model hierarchical \
  --timeout-ms 180000 \
  --max-propagation-depth 40 \
  --ifds-stats \
  --output out/lifecycle-m1-resource-real-apps-unbounded.json
```

两个报告均满足 `completed=true`、48/48 项目完成、48 个成功、0 个失败、0 个超时。

## 3. 时间结果

时间为 48 个项目的累计值。括号内是 M1 相对 M0 的变化。

| 阶段 | M0 Flat | M1 Hierarchical | 变化 |
| --- | ---: | ---: | ---: |
| 全流程 | 189.824 s | 189.529 s | -0.295 s（-0.16%） |
| Scene 构建 | 141.958 s | 141.616 s | -0.342 s（-0.24%） |
| 生命周期建模 | 11.301 s | 11.320 s | +0.019 s（+0.17%） |
| 资源分析整体 | 36.369 s | 36.404 s | +0.035 s（+0.10%） |
| **IFDS solve** | **17.354 s** | **17.308 s** | **-0.046 s（-0.27%）** |

IFDS 单项目平均值从 361.54 ms 变为 360.58 ms。按项目配对，M1 有 22 个更快、23 个更慢、3 个相同；配对差值中位数为 0 ms。全流程有 24 个更快、24 个更慢，配对差值中位数为 +1.5 ms。

Scene 构建不受生命周期模型实现影响，但本轮也波动了 -0.24%。IFDS 的 -0.27% 与这一背景波动处于相近量级。

## 4. IFDS 工作量

| 指标 | M0 Flat | M1 Hierarchical | 变化 |
| --- | ---: | ---: | ---: |
| `propagationAttempts` | 755,037 | 755,874 | +837（+0.11%） |
| `deferredPropagationAttempts` | 521,387 | 522,263 | +876（+0.17%） |
| `uniqueEdgesEnqueued` / `processedEdges` | 579,829 | 580,254 | +425（+0.07%） |
| `duplicateEdgesSkipped` | 175,208 | 175,620 | +412（+0.24%） |
| `deduplicationCandidateChecks` | 217,371 | 217,794 | +423（+0.19%） |
| `factEqualityChecks` | 392,579 | 393,414 | +835（+0.21%） |
| `maxCombinedQueueSize` | 760 | 762 | +2（+0.26%） |

M1 的唯一边和主要传播计数没有下降，反而增加约 0.07%–0.21%。因此，本轮 IFDS 时间减少 0.046 秒不能归因为求解工作量减少，更可能是冷进程、系统负载、JIT 和计时粒度带来的波动。

修正前曾使用 Ability=3、Navigation=5 做过一轮配对。关闭这两个预算后，除 `solveTimeMs` 外的全部 IFDS 聚合计数在 M0、M1 中分别与修正前完全一致。这说明旧预算没有在当前 48 个项目和资源规则下实际截断传播；重新运行仍有必要，因为 M0/M1 的实验定义不应依赖这些 K-bound。

## 5. 结果一致性与内存

把报告记录按内容规范化为集合后，两组在每个项目上的资源泄漏、污点泄漏和方法内资源泄漏集合完全一致，汇总结果也一致。`harmony-utils` 的资源泄漏数组顺序不同，但 8 条记录的内容相同；其余数组连顺序也相同。

| 指标 | M0 Flat | M1 Hierarchical |
| --- | ---: | ---: |
| 有报告项目数 | 34 | 34 |
| 资源泄漏数 | 21 | 21 |
| 污点泄漏数 | 0 | 0 |
| 方法内资源泄漏数 | 307 | 307 |

合成 CFG 形状改变后，45/48 个项目的 reached 计数发生细小变化：`reachedStatements` 总计 303,184 → 303,209，`reachedFacts` 总计 579,829 → 580,254。`account_app_harmonyos`、`Accouting_ArkTS` 和 `HarmonyUtilCode` 的两项计数均不变。

进程峰值 RSS 的项目平均值为 379 → 382 MB（+0.79%），最大值为 766.16 → 810.43 MB（+5.78%）。这是进程级峰值，包含前端和运行时；单轮数据不支持内存回归或改善结论。

## 6. 结论

这轮无生命周期 K-bound 的 48 项目配对实验没有观察到 M1 的可归因性能提升。IFDS solve 时间表面下降 0.27%，但传播工作量略有增加，且不受模型影响的 Scene 阶段也出现 0.24% 的同向波动。更稳妥的结论是：当前 M1 与 M0 的分析时间基本相同，变化在单轮测量噪声范围内。

本实验也没有真实应用 ground truth，因此“诊断集合相同”只说明 M1 没有改变这批资源分析报告，不能推出真实精度相同。M1 的精度收益仍由 controlled benchmark 中排除跨层非法路径的结果支持。

## 7. Ability owner 优化后的空指针分析补充实验

本轮在 M1 中加入明确的 `Ability → Component → UI callback` 归属：能够从
`loadContent` 解析 owner 的页面只进入所属 Ability 的 Page/UI scope；无法解析
owner 的组件保留在独立的保守 scope 中。`AbilityCollector` 同时复用同一批
`ComponentInfo`，避免 owner 关联对象与后来填充 UI callback 的对象分离。

项目由旧的 48 项空指针报告按 `analysisTimeMs` 排序选出前 5。根据运行时指令，
KeePassHO 在本轮配对中被跳过，最终比较其余 4 项。两组均为单轮冷进程，使用
`maxAccessPathLength=5`、`maxPropagationDepth=40`，未设置生命周期 K-bound。

| 项目 | M0 IFDS | M1 IFDS | M1 相对变化 | M0/M1 诊断数 |
| --- | ---: | ---: | ---: | ---: |
| CoolMallArkTS | 9.456 s | 10.024 s | +6.01% | 0 / 0 |
| harmony-utils | 15.038 s | 15.181 s | +0.95% | 2 / 2 |
| JellyFin_HarmonyOS | 1.696 s | 1.757 s | +3.60% | 4 / 4 |
| jingmo-for-HarmonyOS | 7.852 s | 8.039 s | +2.38% | 0 / 0 |
| **合计** | **34.042 s** | **35.001 s** | **+2.82%** | **6 / 6** |

M0/M1 的空指针诊断集合逐项目按内容规范化后完全相同。M1 的
`processedEdges` 从 1,833,560 增至 1,844,176（+0.58%），`reachedFacts`
从 1,744,665 增至 1,755,281（+0.61%），空指针分析整体时间从 47.054 s
增至 48.599 s（+3.28%）。四个项目的 IFDS 时间都没有下降。

这说明 owner 约束在 CFG 语义上已经生效，但没有自动减少 IFDS 状态空间。
原因是当前 M1 为每个 Ability 建立独立的分支和循环节点，同时未知 owner 的组件
仍需保守保留；若真实项目多数只有一个已识别 Ability，或空指针事实没有跨
Ability 共享，删除跨 Ability 直接转移带来的收益很小，新增 CFG 节点反而会产生
少量额外 path edge。本轮只有一次配对，2.82% 时间差不能作为稳定回归结论；
传播计数同向增加则足以说明当前实现没有取得预期的 solver 工作量削减。

原始报告为 `out/nullness-realapps-top5-m0.json` 和
`out/nullness-realapps-top4-m1.json`。前者保留了被跳过的 KeePassHO 失败记录，
汇总比较只使用两份报告中共同成功的 4 个项目。

## 8. M1 CFG 优化与 root 分项实验

### 8.1 实验设置

本轮实现了三项 M1 优化：

1. 用一个 scope dispatcher 直接连接各 callback invocation block，移除逐项条件链；
2. 不再生成没有 callback 的空分支和空 scope；
3. 从 entry Ability 出发，只保留静态 `startAbility` 可达的 Ability，并排除
   `ohosTest`、`src/test` 中的测试 Ability。若 entry 缺失或发现无法解析的
   `startAbility` 目标，则保守地关闭 Ability 裁剪。页面 Component 内的
   `startAbility` 会归并到所属 Ability；Component owner 无法确定时也关闭裁剪。

空指针分析新增两类统计：生命周期 DummyMain root 与 module initializer、
framework sink 等 supplemental roots 的 IFDS 时间和工作量分别记录；同时记录
DummyMain 的 Ability、Component、block 和 edge 数量。

实验仍使用上一节除 KeePassHO 外的四个慢项目。每种配置运行一次冷进程，
`maxAccessPathLength=5`、`maxPropagationDepth=40`，没有设置生命周期 K-bound。
为了区分 M1 CFG 本身和 supplemental roots 的成本，运行了两组配对实验：

- **完整 roots**：保持真实应用分析的默认 root 集合；
- **lifecycle-root-only**：关闭 module initializer 和 framework sink roots，只分析
  生命周期 DummyMain root。

四份报告分别为：

- `out/nullness-m1opt-full-m0.json`
- `out/nullness-m1opt-full-m1.json`
- `out/nullness-m1opt-lifecycle-only-m0.json`
- `out/nullness-m1opt-lifecycle-only-m1.json`

### 8.2 完整 roots 结果

| 指标 | M0 Flat | 优化后 M1 | 变化 |
| --- | ---: | ---: | ---: |
| IFDS solve | 34.159 s | 29.649 s | -13.20% |
| 生命周期 root IFDS | 24.924 s | 20.604 s | -17.33% |
| supplemental roots IFDS | 9.235 s | 9.045 s | -2.06% |
| 空指针分析整体 | 47.201 s | 42.341 s | -10.30% |
| 全流程 | 62.406 s | 57.553 s | -7.78% |
| `processedEdges` | 1,831,793 | 1,596,563 | -12.84% |
| `propagationAttempts` | 2,389,535 | 2,153,894 | -9.86% |
| `reachedFacts` | 1,742,898 | 1,507,668 | -13.50% |
| `reachedStatements` | 120,485 | 118,344 | -1.78% |
| DummyMain blocks | 3,242 | 1,633 | -49.63% |
| DummyMain edges | 4,857 | 3,245 | -33.19% |
| 建模 Ability 数 | 9 | 5 | -44.44% |

四个项目共执行 101 个 supplemental roots，M0 和 M1 数量相同。它们的 IFDS
时间只变化 -2.06%，而生命周期 root 降低 17.33%，说明收益主要来自 M1 的
生命周期 CFG，而不是其它 root 的偶然变化。两组空指针诊断集合逐项目按内容
规范化后完全一致。

| 项目 | M0 IFDS | 优化后 M1 IFDS | 变化 | M0/M1 CFG blocks | M0/M1 Ability |
| --- | ---: | ---: | ---: | ---: | ---: |
| CoolMallArkTS | 9.410 s | 7.254 s | -22.91% | 415 / 211 | 2 / 1 |
| harmony-utils | 14.990 s | 14.237 s | -5.02% | 1,881 / 946 | 1 / 1 |
| JellyFin_HarmonyOS | 1.765 s | 1.704 s | -3.46% | 91 / 47 | 3 / 2 |
| jingmo-for-HarmonyOS | 7.994 s | 6.454 s | -19.26% | 855 / 429 | 3 / 1 |

`harmony-utils` 的 Ability 数没有减少，但 blocks 仍从 1,881 降到 946，且 IFDS
时间降低 5.02%。这个样本说明 compact dispatcher 本身能够减少工作量，收益
并非全部来自 Ability 裁剪。

### 8.3 Lifecycle root only 结果

| 指标 | M0 Flat | 优化后 M1 | 变化 |
| --- | ---: | ---: | ---: |
| IFDS solve | 25.083 s | 20.420 s | -18.59% |
| 空指针分析整体 | 31.664 s | 26.840 s | -15.23% |
| 全流程 | 46.749 s | 42.145 s | -9.85% |
| `processedEdges` | 1,730,253 | 1,495,023 | -13.60% |
| `reachedFacts` | 1,730,163 | 1,494,933 | -13.60% |

| 项目 | M0 IFDS | 优化后 M1 IFDS | 变化 |
| --- | ---: | ---: | ---: |
| CoolMallArkTS | 5.769 s | 3.662 s | -36.52% |
| harmony-utils | 14.025 s | 12.828 s | -8.53% |
| JellyFin_HarmonyOS | 0.931 s | 0.938 s | +0.75% |
| jingmo-for-HarmonyOS | 4.358 s | 2.992 s | -31.34% |

生命周期 root 单独比较时，M1 的 IFDS 时间降低 18.59%，工作边数和 reached
facts 均降低 13.60%，诊断集合仍完全一致。JellyFin 的 +7 ms 属于单轮计时可见
的微小波动，不能据此认定回归。

### 8.4 与优化前 M1 的关系

在同样四个项目和完整 roots 下，优化前 M1 的 IFDS 时间为 35.001 s，优化后为
29.649 s（-15.29%）；`processedEdges` 从 1,844,176 降至 1,596,563
（-13.43%）；空指针分析整体时间从 48.599 s 降至 42.341 s（-12.88%）。
诊断集合完全一致。

这两组小实验支持“原 M1 没有效率收益主要是 CFG 表达过重”的解释。compact
dispatcher、空 scope 清理和可达 Ability 裁剪组合后，生命周期 root 的 IFDS
工作量和耗时都明显下降。由于三项优化同时启用，当前数据不能精确分摊每一项的
独立贡献；以上结果也只是四个项目各一次冷运行，不代表完整 48 项目上的稳定
加速或方差结论。

## 9. 48 项真实应用空指针分析

### 9.1 实验设置与完成情况

在补充“Component 内的 `startAbility` 归并到 owner，owner 或目标不明时停止
Ability 裁剪”的保守处理后，对 `HarmonyRealApps/meta.json` 中全部 48 个项目
重新运行 M0 和 M1。两组都使用完整 root 集合、`maxAccessPathLength=5`、
`maxPropagationDepth=40` 和 `timeout=60000ms`，每种配置单轮冷进程运行。

```bash
npm run test:nullness:real-apps -- \
  --lifecycle-model flat \
  --timeout-ms 60000 \
  --max-access-path-length 5 \
  --max-propagation-depth 40 \
  --ifds-stats \
  --output out/nullness-m1opt-full48-m0.json

npm run test:nullness:real-apps -- \
  --lifecycle-model hierarchical \
  --timeout-ms 60000 \
  --max-access-path-length 5 \
  --max-propagation-depth 40 \
  --ifds-stats \
  --output out/nullness-m1opt-full48-m1.json
```

两组都完成 48/48 个项目：47 个成功、0 个失败、1 个超时。KeePassHO 在两组中
均达到 60 秒限制，因此累计性能只比较共同成功的 47 个项目。

### 9.2 汇总结果

| 指标（47 个共同成功项目） | M0 Flat | 优化后 M1 | 变化 |
| --- | ---: | ---: | ---: |
| 全流程累计 | 242.401 s | 215.796 s | -10.98% |
| 空指针分析累计 | 109.256 s | 90.538 s | -17.13% |
| IFDS solve 累计 | 78.596 s | 62.873 s | -20.00% |
| 生命周期 root IFDS | 54.271 s | 40.630 s | -25.13% |
| supplemental roots IFDS | 24.325 s | 22.243 s | -8.56% |
| `processedEdges` | 3,735,159 | 3,310,554 | -11.37% |
| 生命周期 root `processedEdges` | 3,404,661 | 2,980,056 | -12.47% |
| supplemental `processedEdges` | 330,498 | 330,498 | 0 |
| `propagationAttempts` | 4,660,217 | 4,232,421 | -9.18% |
| `factEqualityChecks` | 1,924,301 | 1,917,919 | -0.33% |
| `reachedFacts` | 3,423,032 | 2,998,427 | -12.40% |
| `reachedStatements` | 471,041 | 461,918 | -1.94% |
| DummyMain blocks | 16,237 | 8,306 | -48.85% |
| DummyMain edges | 24,285 | 16,356 | -32.65% |
| 建模 Ability 数 | 97 | 64 | -34.02% |
| 建模 Component 数 | 2,024 | 2,021 | -0.15% |

47 个项目中，M1 的 IFDS 时间有 43 个下降、2 个上升、2 个相同，配对差值
中位数为 -56 ms。上升的两个项目是 rdbStore（50 → 52 ms）和 STUFFS_NEXT
（1,304 → 1,342 ms），差值分别为 2 ms 和 38 ms。

两组的 supplemental root 数均为 553，且 supplemental `processedEdges` 完全相同。
因此 supplemental 时间的 -8.56% 不对应工作量变化，不能归因于 M1；可归因的
证据是生命周期 root 的 `processedEdges` 降低 12.47%，同时 IFDS 时间降低
25.13%。

两组均有 11 个项目产生诊断，诊断总数均为 46。对每个成功项目的诊断记录按
字段排序并规范化为集合后，M0 和 M1 的诊断集合逐项目完全相同。这说明本轮 M1
优化没有改变已报告结果；由于真实应用没有 ground truth，不能由此推出 precision
或 recall 不变。

### 9.3 各项目 IFDS 结果

| 项目 | M0/M1 状态 | M0 IFDS | M1 IFDS | 变化 | M0/M1 诊断 |
| --- | --- | ---: | ---: | ---: | ---: |
| account_app_harmonyos | success / success | 0.312 s | 0.278 s | -10.90% | 0 / 0 |
| Accouting_ArkTS | success / success | 0.434 s | 0.364 s | -16.13% | 0 / 0 |
| Aigis | success / success | 1.086 s | 0.957 s | -11.88% | 6 / 6 |
| browser | success / success | 0.116 s | 0.094 s | -18.97% | 0 / 0 |
| ccplayer | success / success | 2.642 s | 2.319 s | -12.23% | 0 / 0 |
| cloud-foundation-kit_-codelab_-arkts | success / success | 0.100 s | 0.088 s | -12.00% | 0 / 0 |
| CloudMusic-HarmonyOSNex | success / success | 2.949 s | 2.428 s | -17.67% | 0 / 0 |
| ColdStartPerformanceIssue | success / success | 0.297 s | 0.261 s | -12.12% | 0 / 0 |
| CoolMallArkTS | success / success | 9.586 s | 6.375 s | -33.50% | 0 / 0 |
| DistributedMail | success / success | 0.056 s | 0.047 s | -16.07% | 0 / 0 |
| echo | success / success | 0.074 s | 0.071 s | -4.05% | 0 / 0 |
| AnimeZ | success / success | 2.379 s | 2.341 s | -1.60% | 20 / 20 |
| ElderMate | success / success | 1.049 s | 0.848 s | -19.16% | 0 / 0 |
| ExploreHarmonyNext | success / success | 0.073 s | 0.069 s | -5.48% | 0 / 0 |
| FinVideo | success / success | 0.851 s | 0.740 s | -13.04% | 2 / 2 |
| Gramony | success / success | 1.750 s | 1.402 s | -19.89% | 0 / 0 |
| Harflix | success / success | 0.984 s | 0.859 s | -12.70% | 0 / 0 |
| HarmoneyOpenEye | success / success | 0.420 s | 0.364 s | -13.33% | 0 / 0 |
| harmony-utils | success / success | 15.018 s | 12.550 s | -16.43% | 2 / 2 |
| HarmonyAtomicService | success / success | 0.218 s | 0.196 s | -10.09% | 3 / 3 |
| HarmonyKit | success / success | 1.475 s | 1.097 s | -25.63% | 0 / 0 |
| HarmonyOS-mall | success / success | 0.579 s | 0.481 s | -16.93% | 0 / 0 |
| HarmonyOS | success / success | 0.507 s | 0.433 s | -14.60% | 0 / 0 |
| HarmonyOsRefresh | success / success | 2.710 s | 2.434 s | -10.18% | 0 / 0 |
| HarmonyUtilCode | success / success | 0.501 s | 0.458 s | -8.58% | 2 / 2 |
| Homogram | success / success | 1.679 s | 1.397 s | -16.80% | 0 / 0 |
| interview-handbook-project-next | success / success | 2.077 s | 1.868 s | -10.06% | 0 / 0 |
| JellyFin_HarmonyOS | success / success | 1.791 s | 1.550 s | -13.46% | 4 / 4 |
| jingmo-for-HarmonyOS | success / success | 8.106 s | 6.047 s | -25.40% | 0 / 0 |
| KeePassHO | timeout / timeout | — | — | — | 0 / 0 |
| LinysBrowser_NEXT | success / success | 7.808 s | 4.670 s | -40.19% | 2 / 2 |
| mcCharts | success / success | 0.956 s | 0.870 s | -9.00% | 0 / 0 |
| MiShop_HarmonyOS | success / success | 0.114 s | 0.102 s | -10.53% | 0 / 0 |
| MultiVideoApplication | success / success | 1.151 s | 1.030 s | -10.51% | 0 / 0 |
| MusicHome | success / success | 3.160 s | 2.637 s | -16.55% | 0 / 0 |
| ohos_electron_hap | success / success | 1.141 s | 0.806 s | -29.36% | 0 / 0 |
| open_neteasy_cloud | success / success | 0.089 s | 0.086 s | -3.37% | 0 / 0 |
| OxHornCampus | success / success | 0.429 s | 0.382 s | -10.96% | 2 / 2 |
| PageSlipPerformanceIssue | success / success | 0.342 s | 0.340 s | -0.58% | 2 / 2 |
| rdbStore | success / success | 0.050 s | 0.052 s | +4.00% | 0 / 0 |
| ringtone-kit_-sample-code_-demo | success / success | 0.023 s | 0.018 s | -21.74% | 0 / 0 |
| TransitionPerformanceIssue | success / success | 0.220 s | 0.220 s | +0.00% | 0 / 0 |
| uidesign_kit_codelab_hdsnavigation_arkts | success / success | 0.043 s | 0.043 s | +0.00% | 0 / 0 |
| Wechat_HarmonyOS | success / success | 0.471 s | 0.457 s | -2.97% | 0 / 0 |
| Youtube-Music-ArkTS-Clone | success / success | 0.386 s | 0.336 s | -12.95% | 1 / 1 |
| hll-wp-therouter-harmony | success / success | 0.322 s | 0.304 s | -5.59% | 0 / 0 |
| Rental | success / success | 0.768 s | 0.762 s | -0.78% | 0 / 0 |
| STUFFS_NEXT | success / success | 1.304 s | 1.342 s | +2.91% | 0 / 0 |

### 9.4 结论

完整 48 项实验支持 M1 优化有效：共同成功项目的 IFDS 累计时间降低 20.00%，
生命周期 root 的传播工作量降低 12.47%，43/47 个项目的 IFDS 时间下降，且诊断
集合不变。收益主要来自 compact dispatcher 和 scope CFG 缩减；Ability 裁剪也有
贡献，但并非必要条件，例如只有一个 Ability 的 harmony-utils 仍从 15.018 s
降至 12.550 s。

这仍是单轮配对实验。时间数据可以说明本轮工作量削减与明显的运行时间下降同向，
但不能提供方差或稳定加速区间。KeePassHO 在 60 秒限制下无法用于模型比较。
