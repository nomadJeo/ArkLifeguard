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
