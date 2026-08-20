# HarmonyRealApps

本项目提供了一个真实应用集合，供 ArkLifeguard 测试使用。每个项目都包含了完整的 Git 仓库信息、SDK 版本信息和编译信息。

`meta.json` 是真实应用集合的清单。每个项目只需要手动填写仓库地址：

```json
{
  "projects": [
    { "repo": "https://gitee.com/harmonyos_codelabs/OxHornCampus.git" },
    { "repo": "https://github.com/Z-P-J/AnimeZ.git" }
  ]
}
```

然后运行：

```bash
npm run sync:real-apps
```

脚本会自动生成 `name` 和 `path`，克隆本地不存在的仓库，记录当前分支及完整
commit，并从项目根目录的 `build-profile.json5` 提取 compile、compatible 和
target SDK 版本。项目没有声明的版本会写成 `null`，不会用
`targetSdkVersion` 冒充缺失的 `compileSdkVersion`。

对于已经存在的项目，脚本不会自动执行 `pull` 或切换分支，只记录当前干净的
checkout。如果项目存在未提交修改、origin 与 `repo` 不一致，或者 Git 根目录实际
指向外层 ArkLifeguard 仓库，该项目会报错。

单个项目克隆或解析失败不会中断整个任务。脚本会继续处理后续项目，在该项目中
保留 `repo` 并写入自动生成的 `error`，最后汇总成功和失败数量。下次重新运行时会
再次尝试失败项目。GitHub、Gitee 和 GitCode 的 HTTPS 克隆失败后，会自动尝试对应
的 SSH 地址。
