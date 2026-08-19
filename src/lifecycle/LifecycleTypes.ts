/*
 * Copyright (c) 2024-2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @file LifecycleTypes.ts
 * @description 生命周期建模相关的类型定义
 *
 * 本文件定义了扩展 DummyMain 所需的核心数据结构，包括：
 * - Ability 信息结构
 * - 页面跳转关系
 * - UI 组件回调信息
 * - 生命周期阶段枚举
 */

import {ArkClass} from "arkanalyzer/lib/core/model/ArkClass";
import {ArkMethod} from "arkanalyzer/lib/core/model/ArkMethod";
import {ClassSignature} from "arkanalyzer/lib/core/model/ArkSignature";
import {ArkField} from "arkanalyzer/lib/core/model/ArkField";
import {ViewTreeNode} from "arkanalyzer/lib/core/graph/ViewTree";

// ============================================================================
// 第一部分：生命周期阶段定义
// ============================================================================

/**
 * Ability 生命周期阶段枚举
 *
 * 鸿蒙 UIAbility 的完整生命周期：
 * Create -> WindowStageCreate -> Foreground <-> Background -> WindowStageDestroy -> Destroy
 */
export enum AbilityLifecycleStage {
  /** Ability 实例创建 */
  CREATE = "onCreate",
  /** 窗口创建（UI 可用） */
  WINDOW_STAGE_CREATE = "onWindowStageCreate",
  /** WindowStage 销毁前，仍可访问 WindowStage 对象 */
  WINDOW_STAGE_WILL_DESTROY = "onWindowStageWillDestroy",
  /** WindowStage 恢复 */
  WINDOW_STAGE_RESTORE = "onWindowStageRestore",
  /** 进入前台（可见） */
  FOREGROUND = "onForeground",
  /** 进入后台（不可见） */
  BACKGROUND = "onBackground",
  /** 跨设备迁移 */
  CONTINUE = "onContinue",
  /** 已存在 Ability 收到新 Want */
  NEW_WANT = "onNewWant",
  /** 输出 Ability 调试信息 */
  DUMP = "onDump",
  /** 保存 Ability 状态 */
  SAVE_STATE = "onSaveState",
  /** 分享事件 */
  SHARE = "onShare",
  /** 终止前同步准备 */
  PREPARE_TO_TERMINATE = "onPrepareToTerminate",
  /** 终止前异步准备 */
  PREPARE_TO_TERMINATE_ASYNC = "onPrepareToTerminateAsync",
  /** Ability 回退事件 */
  BACK_PRESSED = "onBackPressed",
  /** 窗口销毁 */
  WINDOW_STAGE_DESTROY = "onWindowStageDestroy",
  /** Ability 销毁 */
  DESTROY = "onDestroy",
}

/** BackupExtensionAbility 的备份与恢复生命周期。 */
export enum BackupExtensionLifecycleStage {
  BACKUP = "onBackup",
  BACKUP_EX = "onBackupEx",
  RESTORE = "onRestore",
  RESTORE_EX = "onRestoreEx",
  PROCESS = "onProcess",
}

/** FormExtensionAbility 中表单创建与后续更新的系统回调。 */
export enum FormExtensionLifecycleStage {
  ADD_FORM = "onAddForm",
  UPDATE_FORM = "onUpdateForm",
}

export type AbilityLifecycleMethodStage =
  | AbilityLifecycleStage
  | BackupExtensionLifecycleStage
  | FormExtensionLifecycleStage;

/**
 * Component 生命周期阶段枚举
 *
 * 鸿蒙 @Component 组件的生命周期
 */
export enum ComponentLifecycleStage {
  /** 组件即将出现 */
  ABOUT_TO_APPEAR = "aboutToAppear",
  /** 构建 UI */
  BUILD = "build",
  /** 首次 build 完成 */
  DID_BUILD = "onDidBuild",
  /** 组件即将消失 */
  ABOUT_TO_DISAPPEAR = "aboutToDisappear",
  /** 页面显示 */
  PAGE_SHOW = "onPageShow",
  /** 页面隐藏 */
  PAGE_HIDE = "onPageHide",
  /** 页面回退 */
  BACK_PRESS = "onBackPress",
  /** 可复用组件被重新加入组件树 */
  ABOUT_TO_REUSE = "aboutToReuse",
  /** 可复用组件被回收 */
  ABOUT_TO_RECYCLE = "aboutToRecycle",
  /** 主题应用前回调 */
  WILL_APPLY_THEME = "onWillApplyTheme",
  /** 组件按键事件入口 */
  KEY_EVENT = "onKeyEvent",
}

// ============================================================================
// 第二部分：Ability 信息结构
// ============================================================================

/**
 * Ability 信息接口
 *
 * 存储单个 Ability 的完整信息，包括：
 * - 类信息
 * - 生命周期方法
 * - 关联的 Component
 * - 可跳转的目标 Ability
 */
export interface AbilityInfo {
  /** Ability 的类 */
  arkClass: ArkClass;

  /** 类签名（唯一标识） */
  signature: ClassSignature;

  /** Ability 名称 */
  name: string;

  /** 生命周期方法映射：阶段 -> 方法 */
  lifecycleMethods: Map<AbilityLifecycleMethodStage, ArkMethod>;

  /** 该 Ability 关联的 UI Component 列表 */
  components: ComponentInfo[];

  /** 可跳转到的目标 Ability 列表 */
  navigationTargets: AbilityNavigationTarget[];

  /** 是否是入口 Ability（在 module.json5 中配置） */
  isEntry: boolean;
}

/**
 * Component 信息接口
 *
 * 存储单个 @Component 组件的信息
 */
export interface ComponentInfo {
  /** Component 的类 */
  arkClass: ArkClass;

  /** 类签名 */
  signature: ClassSignature;

  /** Component 名称 */
  name: string;

  /** 生命周期方法映射 */
  lifecycleMethods: Map<ComponentLifecycleStage, ArkMethod>;

  /** 该 Component 中的 UI 控件回调列表 */
  uiCallbacks: UICallbackInfo[];

  /** 是否是 @Entry 组件 */
  isEntry: boolean;
}

// ============================================================================
// 第三部分：页面跳转关系
// ============================================================================

/**
 * Ability 跳转目标
 *
 * 表示一个 Ability 可以跳转到另一个 Ability 的关系
 */
export interface AbilityNavigationTarget {
  /** 目标 Ability 的名称（从 Want 中解析） */
  targetAbilityName: string;

  /** 目标 Ability 的类签名（如果能解析到） */
  targetSignature?: ClassSignature;

  /** 触发跳转的语句所在方法 */
  sourceMethod: ArkMethod;

  /** 跳转类型 */
  navigationType: NavigationType;
}

/**
 * 跳转类型枚举
 */
export enum NavigationType {
  /** startAbility - 启动新 Ability */
  START_ABILITY = "startAbility",
  /** router.pushUrl - 页面路由跳转 */
  ROUTER_PUSH = "router.pushUrl",
  /** router.replaceUrl - 页面路由替换 */
  ROUTER_REPLACE = "router.replaceUrl",
  /** 返回上一页 */
  ROUTER_BACK = "router.back",
}

// ============================================================================
// 第四部分：UI 回调信息
// ============================================================================

/**
 * UI 回调信息接口
 *
 * 表示一个 UI 控件上的事件回调
 *
 * 例如：Button().onClick(() => { ... })
 */
export interface UICallbackInfo {
  /** 控件类型（Button, Text, Image 等） */
  componentType: string;

  /** 回调事件类型（onClick, onTouch 等） */
  eventType: UIEventType;

  /** 回调方法 */
  callbackMethod: ArkMethod;

  /** 该回调依赖的状态变量 */
  relatedStateValues: ArkField[];

  /** 来自 ViewTree 的节点引用（可选） */
  viewTreeNode?: ViewTreeNode;
}

/**
 * UI 事件类型枚举
 *
 * 对应 ArkUI 中常见的交互事件
 */
export enum UIEventType {
  /** 点击事件 */
  ON_CLICK = "onClick",
  /** 触摸事件 */
  ON_TOUCH = "onTouch",
  /** 值变化事件 (TextInput, Slider, Toggle 等) */
  ON_CHANGE = "onChange",
  /** 出现事件 */
  ON_APPEAR = "onAppear",
  /** 消失事件 */
  ON_DISAPPEAR = "onDisAppear",
  /** 拖拽开始 */
  ON_DRAG_START = "onDragStart",
  /** 拖拽释放 */
  ON_DROP = "onDrop",
  /** 获取焦点 */
  ON_FOCUS = "onFocus",
  /** 失去焦点 */
  ON_BLUR = "onBlur",
  /** 区域变化 */
  ON_AREA_CHANGE = "onAreaChange",
  /** 选择事件 (Select, Menu 等) */
  ON_SELECT = "onSelect",
  /** 提交事件 (Search, TextInput 等) */
  ON_SUBMIT = "onSubmit",
  /** 滚动事件 (List, Scroll 等) */
  ON_SCROLL = "onScroll",
}

// ============================================================================
// 第五部分：DummyMain 构建配置
// ============================================================================

/**
 * 有界约束配置
 *
 * 对应论文中的三条约束：
 * - 约束1（Ability 数量）：单条数据流最多流经 maxAbilitiesPerFlow 个不同 Ability
 * - 约束2（UI 事件响应次数）：Ability+Component 生命周期序列最多重复 maxCallbackIterations 次
 * - 约束3（路由跳转次数）：单条数据流最多经历 maxNavigationHops 次页面路由跳转
 */
export interface BoundsConfig {
  /**
   * 约束2：整个 Ability+Component 生命周期回调序列的最大重复次数（循环展开次数）
   *
   * - 1 = 每个回调只执行一次，DummyMain CFG 变为 DAG（推荐，默认值）
   * - 2+ = 允许重复，覆盖更多路径但分析代价更高
   *
   * 此参数直接控制 CFG 结构，由 LifecycleModelCreator 在构建时消费。
   */
  maxCallbackIterations: number;

  /**
   * 约束1：单条数据流最多流经几个不同的 Ability（0 = 不限制）
   *
   * 由 IFDS 层在 TaintFact 传播时检查（Phase 2 实现）。
   */
  maxAbilitiesPerFlow: number;

  /**
   * 约束3：单条数据流最多经历几次页面路由跳转（0 = 不限制）
   *
   * 由 IFDS 层在检测到 router.pushUrl / startAbility 时检查（Phase 2 实现）。
   */
  maxNavigationHops: number;
}

/**
 * 扩展 DummyMain 的配置选项
 */
export interface LifecycleModelConfig {
  /** 是否包含多 Ability 跳转建模 */
  enableMultiAbilityNavigation: boolean;

  /** 是否精细化建模 UI 回调（按控件实例化） */
  enableFineGrainedUICallbacks: boolean;

  /** 是否解析 ViewTree 提取回调 */
  enableViewTreeParsing: boolean;

  /** 生命周期方法调用顺序（可自定义） */
  lifecycleOrder: AbilityLifecycleMethodStage[];

  /** 最大跳转深度（防止无限循环） */
  maxNavigationDepth: number;

  /** 有界约束配置 */
  bounds: BoundsConfig;
}

/**
 * 默认配置
 */
export const DEFAULT_LIFECYCLE_CONFIG: LifecycleModelConfig = {
  enableMultiAbilityNavigation: true,
  enableFineGrainedUICallbacks: true,
  enableViewTreeParsing: true,
  lifecycleOrder: [
    AbilityLifecycleStage.CREATE,
    AbilityLifecycleStage.WINDOW_STAGE_CREATE,
    AbilityLifecycleStage.WINDOW_STAGE_RESTORE,
    AbilityLifecycleStage.FOREGROUND,
    AbilityLifecycleStage.CONTINUE,
    AbilityLifecycleStage.NEW_WANT,
    AbilityLifecycleStage.DUMP,
    AbilityLifecycleStage.SAVE_STATE,
    AbilityLifecycleStage.SHARE,
    AbilityLifecycleStage.BACK_PRESSED,
    AbilityLifecycleStage.BACKGROUND,
    AbilityLifecycleStage.PREPARE_TO_TERMINATE,
    AbilityLifecycleStage.PREPARE_TO_TERMINATE_ASYNC,
    AbilityLifecycleStage.WINDOW_STAGE_WILL_DESTROY,
    AbilityLifecycleStage.WINDOW_STAGE_DESTROY,
    AbilityLifecycleStage.DESTROY,
    BackupExtensionLifecycleStage.BACKUP,
    BackupExtensionLifecycleStage.BACKUP_EX,
    BackupExtensionLifecycleStage.RESTORE,
    BackupExtensionLifecycleStage.RESTORE_EX,
    BackupExtensionLifecycleStage.PROCESS,
    FormExtensionLifecycleStage.ADD_FORM,
    FormExtensionLifecycleStage.UPDATE_FORM,
  ],
  maxNavigationDepth: 10,
  bounds: {
    maxCallbackIterations: 1, // 默认：单次展开，DummyMain 为 DAG
    maxAbilitiesPerFlow: 3, // 默认：最多跨 3 个 Ability
    maxNavigationHops: 5, // 默认：最多 5 次路由跳转
  },
};
