# ArkDefectBench 空指针测试套件

ArkDefectBench 是独立于 ArkAnalyzer 实现的 HarmonyOS ArkTS 缺陷基准。当前 `Null Pointer Dereference/` 包含 52 个最小样例，覆盖基本空值、数据流、路径敏感、生命周期、回调和异步。安全负例与正例按特性共同放在对应分类中，不再单独设置负例目录。

这里的“空指针”同时包括 ArkTS/JavaScript 运行时中的 `null` 和 `undefined`。源码中的 `NPD_EXPECTED`、`NPD_NOT_EXPECTED` 用于人工阅读；自动测试的权威预期是 `Null Pointer Dereference/null_pointer_expected.json`。
正例应先满足 ArkTS 空安全语法：对可空值使用 `!` 显式绕过编译期检查，再验证运行时空值解引用；不将编译器本应直接拒绝的 nullable 属性访问冒充为可运行缺陷。

## 目录与规模

| 分类 | 数量 | 主要能力 |
| --- | ---: | --- |
| BasicNull | 7 | `null`、`undefined`、非空断言、可选属性、`??` 空回退和多级 `?.` |
| DataFlowPropagation | 9 | 返回值、参数、字段、别名、集合/数组、对象敏感、继承和虚调用 |
| PathSensitivity | 7 | 条件精化、分支合流、强更新、重新初始化、循环和异常路径 |
| Lifecycle | 18 | UIAbility、WindowStage、Component、Page、继承、Extension 与 Ability/Page 跨组件顺序 |
| Callback | 8 | 定时器、监听器、单层/多层闭包、回调注销、单/多 UI 事件和 Promise 回调 |
| Async | 3 | async/await、Promise 链和延迟执行 |
| 合计 | **52** | 40 个预期报告，12 个预期不报告 |

生命周期样例除了常规 `onCreate/onForeground/onBackground/onDestroy`，还覆盖 `onNewWant→onShare`、`onWindowStageCreate→onWindowStageWillDestroy`、继承的 Ability 生命周期、`BackupExtensionAbility`、`FormExtensionAbility`、Ability 与 Page 共享状态，以及多个 UI 事件之间的顺序。每组时序能力尽量配置正例和安全负例，用于同时评估漏报和误报。

每个叶子目录是一个可独立构建的样例，源码放在 `entryability/` 或 `pages/` 中。尚未实现的分析能力也保留在基准里：对应测试失败代表能力缺口，不代表样例未参与测试。

## Oracle 格式

Oracle 当前使用 schema v2。每个用例用稳定 ID、分层分类、所需分析能力和语义化预期描述：

```json
{
  "id": "Lifecycle.Component.StateReset",
  "category": ["Lifecycle", "Component"],
  "features": ["lifecycle-aware", "field-sensitive", "callback-aware"],
  "expected": {
    "bug": true,
    "nullOrigin": { "class": "Index", "method": "onClick" },
    "dereference": { "class": "Index", "method": "aboutToDisappear" },
    "executionPath": [
      { "class": "Index", "method": "aboutToAppear" },
      { "class": "Index", "method": "onClick" },
      { "class": "Index", "method": "aboutToDisappear" }
    ]
  }
}
```

`expected.bug` 为 `false` 表示不应产生报告。测试会核对空值来源和解引用的类/方法；`executionPath` 记录预期语义路径。当前诊断结构尚未导出完整执行路径，因此路径只进行 schema 完整性检查，具体行号继续由源码中的 `NPD_EXPECTED`/`NPD_NOT_EXPECTED` 标记辅助人工核对。

## 执行测试

在 ArkAnalyzer 项目根目录运行全部 52 个样例：

```bash
npm run test:nullness:bench
```

只运行一个样例：

```bash
npm run test:nullness:bench -- --case DirectNull
```

也可以使用完整 ID：

```bash
npm run test:nullness:bench -- --case Lifecycle.Component.StateReset
```

集中脚本同时接受完整 `id` 和 ID 最后一段的短名称，并为每个用例启动独立 Vitest 进程，避免 ArkAnalyzer 的全局 Scene/solver 状态在样例之间残留。

## 人工核对

1. 检查源码中的 `NPD_EXPECTED` 或 `NPD_NOT_EXPECTED` 是否表达了目标控制流。
2. 检查 JSON 的空值来源、解引用方法和执行路径是否与源码一致。
3. 在 DevEco Studio 中运行样例只能验证运行时是否可能崩溃；它不能替代静态分析 oracle。异步、回调和生命周期样例还需要按注释给出的事件顺序触发。
4. 将分析报告分类为 TP、FN、FP；`expected.bug: false` 的安全样例出现任何报告均为 FP。

## 扩展约定

新增样例时，在相应分类下创建唯一的叶子目录，只放一个独立场景，并同步添加 JSON 条目。测试会递归发现所有含 `.ets`/`.ts` 源码的叶子目录；目录存在但 oracle 缺失，或 oracle 指向不存在目录，完整性测试都会失败。

• 可以使用 DevEco Studio 做第二层验证，但需要区分“样例语法”“工程配置”“触发路径”和“分析预期”。

  最关键的一点：! 只绕过 ArkTS 编译期空检查，不会在运行时检查或修复空值。因此 profile!.name 在 profile === null 且语句真正执行时，原则上应产
  生运行时异常。

  ## 构建时注意事项

  当前每个样例目录主要只有一个 .ets 文件，并不是完整的 DevEco Studio 工程。建议准备一个干净的 Stage 模型测试工程，逐个替换：

  - EntryAbility.ets 放入 entry/src/main/ets/entryability/
  - 页面样例放入 entry/src/main/ets/pages/
  - 同步配置 module.json5 中的 Ability 和页面路由
  - 每次只验证一个样例，避免同名 EntryAbility、Index 或全局类冲突
  - 固定 SDK、API Level、DevEco Studio 和设备/模拟器版本
  - 每次运行前清除应用数据，避免生命周期状态残留

  还要区分 warning、ArkTSCheck 错误、依赖错误和真正的语法错误。例如：

   现象                          通常说明
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   找不到 @kit.AbilityKit        SDK、API Level 或工程配置问题
  ────────────────────────────  ───────────────────────────────────────────
   找不到页面/Ability            module.json5 或路由配置问题
  ────────────────────────────  ───────────────────────────────────────────
   可空值不允许直接访问          样例缺少 !、?. 或控制流收窄，属于样例问题
  ────────────────────────────  ───────────────────────────────────────────
   ArkTS 不支持某种 TS 写法      样例不符合 ArkTS 子集，需要修改
  ────────────────────────────  ───────────────────────────────────────────
   未使用变量警告                一般不影响样例语义
  ────────────────────────────  ───────────────────────────────────────────
   编译成功但没有执行目标方法    触发方式或生命周期配置问题

  ## 没有出现空指针异常不一定代表样例错误

  需要根据用例类型判断。

  ### 本来就不应异常

  这 9 个负例或安全用法不应出现异常，例如：

  - GuardedAccess
  - SafeNullCheck
  - NullishCoalescing
  - OptionalChain
  - InitBeforeUse
  - AboutAppearDisappear
  - LifecycleSafe
  - CallbackRemoved
  - ReinitializedObject

  这些样例的价值正是验证分析器不会误报。

  ### 确定性正例没有异常

  例如 DirectNull：

  let profile: UserProfile | null = null;
  let name = profile!.name;

  如果确认：

  1. onCreate 已执行；
  2. profile 确实为 null；
  3. profile!.name 确实执行；
  4. 异常没有被框架或 try/catch 捕获；

  但仍完全没有运行时错误，那么需要重新检查样例对 ArkTS 运行时语义的假设。

  ### 回调或生命周期正例没有异常

  这通常不能直接说明样例错误。例如：

  - 没有点击按钮；
  - 定时器执行前应用退出；
  - EventListener 没有真正 emit；
  - Promise 分支没有进入；
  - 没有执行指定的前后台切换；
  - 组件销毁后没有再次进入；
  - 实际生命周期顺序与 Oracle 不一致。

  这些样例表达的是“存在一条可行执行路径会出错”，不保证应用启动后立刻崩溃。应按照 arkanalyzer-master/arkanalyzer-master/src/TEST_lifecycle/
  ArkDefectBench/Null Pointer Dereference/null_pointer_expected.json 的 executionPath 操作。

  ## 推荐的运行时确认方式

  在不改变数据流语义的前提下，在三个位置加入日志：

  hilog.info(0x0000, 'NPD_TEST', 'source: controller becomes null');
  this.controller = null;

  hilog.info(0x0000, 'NPD_TEST', 'before dereference');
  this.controller!.stop();

  hilog.info(0x0000, 'NPD_TEST', 'after dereference');

  判断方式：

  - 只有 source 日志：后续路径没触发。
  - 有 before、没有 after，并出现异常日志：正例验证成功。
  - 有 before 和 after，但对象此前确认为 null：需要重新检查运行时语义或日志位置。
  - 没有 source 日志：测试前置条件没有发生。
  - 出现异常但应用没有明显退出：可能被 HarmonyOS 运行时统一捕获，应检查 HiLog，而不能只看界面。

  日志只是执行证据，不是空指针 sink；真正的 sink 仍然必须是字段访问、方法调用或数组访问。

  ## 最终判定标准

  “编译报错”只有在错误直接来自样例使用了非法 ArkTS 语法时，才意味着样例设计有问题。SDK、工程结构、路由和生命周期配置错误不属于缺陷语义问题。

  “没有异常”也只有在以下条件全部成立时，才说明正例可能设计错误：

  - Oracle 标记为 bug: true；
  - 目标执行路径确实发生；
  - 空值来源确实执行；
  - 解引用语句确实到达；
  - 解引用时变量确实为 null 或 undefined；
  - 异常未被捕获或被平台日志隐藏。

  建议为每个样例记录：编译结果、触发步骤、source 日志、sink 前日志、异常类型和设备日志。这样可以准确区分样例缺陷、工程问题与分析器漏报。

## DevEco Studio 复测重点

根据首轮 DevEco Studio 结果，以下样例已调整：

| 样例 | 修订后的语义 | 运行时触发方式 |
| --- | --- | --- |
| `FieldPropagation` | `clearAccount()` 写字段，`readBalance()` 跨方法解引用 | Ability 启动后确定性触发 |
| `OptionalChain` | 通过可空返回值构造运行时可空状态，避免常量 `null` 被编译器精化为 `never` | Ability 启动，不应异常 |
| `PromiseCallback` | Promise 回调写入空字段，宏任务调用普通方法解引用 | Ability 启动，查看定时器回调异常 |
| `Closure1` | 单层嵌套函数捕获可空局部变量并解引用 | Ability 启动后确定性触发 |
| `Closure2` | 双层嵌套函数跨层捕获可空局部变量并解引用 | Ability 启动后确定性触发 |
| `ComponentReuse` | `aboutToRecycle()` 清空，`aboutToReuse()` 解引用，并使用 `@Reusable`/`reuseId` | 将组件回收入复用池后再取出 |
| `PageReuse` | `onPageHide()` 清空，同一页面实例再次 `onPageShow()` 时解引用 | 点击“open another page instance”，再点击“return to previous page instance” |
| `NavigationBack` | 点击回调清空后调用 `router.back()`，在 `onPageHide()` 解引用 | 将样例作为非根页面打开，再点击返回按钮 |
| `CallbackRemoved` | 注册和注销传入同一个回调对象，`emit()` 不应再调用它 | Ability 启动，不应异常 |
| `SafeNullCheck` / `GuardedAccess` | 可空值来自方法返回，再进行控制流收窄 | Ability 启动，不应编译失败或产生空指针异常 |

`PageReuse` 的正例路径是“隐藏旧页面 → 显示新页面实例 → 返回旧页面”，不再以关闭应用作为触发步骤。上表为修订后的复测清单；实际编译和设备运行结果应在固定 SDK/API Level 后另行记录。
