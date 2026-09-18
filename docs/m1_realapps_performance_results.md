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
