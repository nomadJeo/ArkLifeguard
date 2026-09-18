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
