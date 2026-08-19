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
 * @file NavigationAnalyzer.ts
 * @description 路由/导航分析器
 *
 * 本模块负责分析代码中的页面跳转关系，包括：
 * - windowStage.loadContent() - Ability 加载初始页面
 * - router.pushUrl() / router.replaceUrl() - 旧版页面间跳转
 * - startAbility() - Ability 间跳转
 * - NavPathStack.pushPath() / replacePath() - 新版路由（传 NavPathInfo 对象）
 * - NavPathStack.pushPathByName() / replacePathByName() - 新版路由（传字符串页面名）
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                      路由分析工作流程                            │
 * ├─────────────────────────────────────────────────────────────────┤
 * │                                                                 │
 * │  输入: ArkClass (Ability 或 Component)                          │
 * │         │                                                       │
 * │         ▼                                                       │
 * │  ┌─────────────────────────────────────────┐                   │
 * │  │ 1. 遍历类的所有方法                      │                   │
 * │  │ 2. 遍历方法中的所有语句                  │                   │
 * │  │ 3. 检查是否是方法调用语句                │                   │
 * │  │ 4. 判断调用的方法名是否是路由方法         │                   │
 * │  │ 5. 解析参数，提取目标页面/Ability        │                   │
 * │  └─────────────────────────────────────────┘                   │
 * │         │                                                       │
 * │         ▼                                                       │
 * │  输出: NavigationTarget[] (跳转目标列表)                        │
 * │                                                                 │
 * └─────────────────────────────────────────────────────────────────┘
 */

import { Scene } from "arkanalyzer/lib/Scene";
import { ArkClass } from "arkanalyzer/lib/core/model/ArkClass";
import { ArkMethod } from "arkanalyzer/lib/core/model/ArkMethod";
import {
  Stmt,
  ArkAssignStmt,
} from "arkanalyzer/lib/core/base/Stmt";
import {
  AbstractInvokeExpr,
  ArkNewExpr,
} from "arkanalyzer/lib/core/base/Expr";
import { Constant } from "arkanalyzer/lib/core/base/Constant";
import { Local } from "arkanalyzer/lib/core/base/Local";
import {
  StringType,
  ClassType,
} from "arkanalyzer/lib/core/base/Type";
import { ArkInstanceFieldRef } from "arkanalyzer/lib";
import {
  AbilityNavigationTarget,
  NavigationType,
  ComponentInfo,
} from "./LifecycleTypes";

// ============================================================================
// 常量定义
// ============================================================================

/**
 * 路由相关方法名称
 */
const NAVIGATION_METHOD_NAMES = {
  /** windowStage.loadContent - 加载初始页面 */
  LOAD_CONTENT: "loadContent",
  /** router.pushUrl - 推入新页面 */
  PUSH_URL: "pushUrl",
  /** router.replaceUrl - 替换当前页面 */
  REPLACE_URL: "replaceUrl",
  /** router.back - 返回上一页 */
  BACK: "back",
  /** context.startAbility - 启动新 Ability */
  START_ABILITY: "startAbility",
  /** NavPathStack.pushPath(info: NavPathInfo) - 新版路由 */
  PUSH_PATH: "pushPath",
  /** NavPathStack.pushPathByName(name, param) - 按页面名跳转 */
  PUSH_PATH_BY_NAME: "pushPathByName",
  /** NavPathStack.replacePath(info: NavPathInfo) - 替换当前路由 */
  REPLACE_PATH: "replacePath",
  /** NavPathStack.replacePathByName(name, param) */
  REPLACE_PATH_BY_NAME: "replacePathByName",
};

/**
 * 路由分析结果
 */
export interface NavigationAnalysisResult {
  /** 初始页面路径（从 loadContent 解析） */
  initialPage: string | null;
  /** 所有跳转目标 */
  navigationTargets: AbilityNavigationTarget[];
  /** 分析过程中的警告信息 */
  warnings: string[];
}

// ============================================================================
// NavigationAnalyzer 类
// ============================================================================

/**
 * 路由/导航分析器
 *
 * 功能：
 * - 分析 Ability 或 Component 中的页面跳转代码
 * - 提取跳转目标（页面路径或 Ability 名称）
 * - 建立源类与目标的关联关系
 *
 * 使用方式：
 * ```typescript
 * const analyzer = new NavigationAnalyzer(scene);
 * const result = analyzer.analyzeClass(abilityClass);
 * console.log('初始页面:', result.initialPage);
 * console.log('跳转目标:', result.navigationTargets);
 * ```
 */
export class NavigationAnalyzer {
  /** 分析场景 */
  private scene: Scene;

  /** 已收集的 Component（用于将路径解析为 ComponentInfo） */
  private componentMap: Map<string, ComponentInfo> = new Map();

  constructor(scene: Scene) {
    this.scene = scene;
  }

  // ========================================================================
  // 公共 API
  // ========================================================================

  /**
   * 设置已收集的 Component 映射
   *
   * 用于将页面路径（如 'pages/Index'）解析为对应的 ComponentInfo
   *
   * @param components Component 信息数组
   */
  public setComponentMap(components: ComponentInfo[]): void {
    this.componentMap.clear();
    for (const comp of components) {
      // 使用组件名作为 key
      this.componentMap.set(comp.name, comp);
      // 也可以用路径风格的 key，如 'pages/Index'
      // 这里假设组件名就是页面名
    }
  }

  /**
   * 分析一个类的所有路由/跳转
   *
   * @param arkClass 要分析的类（Ability 或 Component）
   * @returns 分析结果
   */
  public analyzeClass(arkClass: ArkClass): NavigationAnalysisResult {
    const result: NavigationAnalysisResult = {
      initialPage: null,
      navigationTargets: [],
      warnings: [],
    };

    // 遍历类的所有方法
    for (const method of arkClass.getMethods()) {
      this.analyzeMethod(method, result);
    }

    return result;
  }

  /**
   * 分析单个方法中的路由/跳转
   *
   * @param method 要分析的方法
   * @param result 分析结果（会被修改），如果不提供则创建新的
   * @returns 分析结果中的导航目标数组
   */
  public analyzeMethod(
    method: ArkMethod,
    result?: NavigationAnalysisResult,
  ): AbilityNavigationTarget[] {
    // 如果没有提供 result，创建一个默认的
    const analysisResult: NavigationAnalysisResult = result || {
      initialPage: null,
      navigationTargets: [],
      warnings: [],
    };

    const cfg = method.getCfg();
    if (!cfg) {
      return analysisResult.navigationTargets;
    }

    // 遍历所有基本块
    for (const block of cfg.getBlocks()) {
      // 遍历块中的所有语句
      for (const stmt of block.getStmts()) {
        this.analyzeStmt(stmt, method, analysisResult);
      }
    }

    return analysisResult.navigationTargets;
  }

  // ========================================================================
  // 私有方法：语句分析
  // ========================================================================

  /**
   * 分析单条语句
   */
  private analyzeStmt(
    stmt: Stmt,
    sourceMethod: ArkMethod,
    result: NavigationAnalysisResult,
  ): void {
    // 获取调用表达式
    const invokeExpr = stmt.getInvokeExpr();
    if (!invokeExpr) {
      return;
    }

    // 获取被调用的方法名
    const methodName = this.getMethodName(invokeExpr);
    if (!methodName) {
      return;
    }

    // 根据方法名分派处理
    switch (methodName) {
      case NAVIGATION_METHOD_NAMES.LOAD_CONTENT:
        this.handleLoadContent(invokeExpr, sourceMethod, result);
        break;
      case NAVIGATION_METHOD_NAMES.PUSH_URL:
        this.handleRouterPush(invokeExpr, sourceMethod, result);
        break;
      case NAVIGATION_METHOD_NAMES.REPLACE_URL:
        this.handleRouterReplace(invokeExpr, sourceMethod, result);
        break;
      case NAVIGATION_METHOD_NAMES.START_ABILITY:
        this.handleStartAbility(invokeExpr, sourceMethod, result);
        break;
      case NAVIGATION_METHOD_NAMES.BACK:
        this.handleRouterBack(invokeExpr, sourceMethod, result);
        break;
      // NavPathStack 系列（HarmonyOS 新版路由）
      case NAVIGATION_METHOD_NAMES.PUSH_PATH:
      case NAVIGATION_METHOD_NAMES.REPLACE_PATH:
        this.handleNavPathStackWithInfo(
          invokeExpr,
          sourceMethod,
          result,
          methodName,
        );
        break;
      case NAVIGATION_METHOD_NAMES.PUSH_PATH_BY_NAME:
      case NAVIGATION_METHOD_NAMES.REPLACE_PATH_BY_NAME:
        this.handleNavPathStackByName(
          invokeExpr,
          sourceMethod,
          result,
          methodName,
        );
        break;
    }
  }

  /**
   * 获取调用表达式中的方法名
   */
  private getMethodName(invokeExpr: AbstractInvokeExpr): string | null {
    try {
      const methodSig = invokeExpr.getMethodSignature();
      const methodSubSig = methodSig.getMethodSubSignature();
      return methodSubSig.getMethodName();
    } catch {
      return null;
    }
  }

  // ========================================================================
  // 私有方法：各类路由处理
  // ========================================================================

  /**
   * 处理 windowStage.loadContent('pages/Index')
   *
   * 这是 Ability 加载初始页面的方式
   *
   * 代码示例：
   * ```typescript
   * onWindowStageCreate(windowStage: WindowStage) {
   *     windowStage.loadContent('pages/Index', (err) => { ... });
   * }
   * ```
   */
  private handleLoadContent(
    invokeExpr: AbstractInvokeExpr,
    sourceMethod: ArkMethod,
    result: NavigationAnalysisResult,
  ): void {
    // 第一个参数是页面路径
    const pagePath = this.extractStringArg(invokeExpr, 0);

    if (pagePath) {
      result.initialPage = pagePath;

      // 同时添加到 navigationTargets
      result.navigationTargets.push({
        targetAbilityName: pagePath,
        targetSignature: undefined, // 后续可以解析
        sourceMethod: sourceMethod,
        navigationType: NavigationType.ROUTER_PUSH, // loadContent 类似于 push
      });

      console.log(`[NavigationAnalyzer] Found loadContent: ${pagePath}`);
    } else {
      result.warnings.push(
        `无法解析 loadContent 的目标页面 (${sourceMethod.getName()})`,
      );
    }
  }

  /**
   * 处理 router.pushUrl({ url: 'pages/Detail' })
   *
   * 代码示例：
   * ```typescript
   * Button('Go to Detail')
   *     .onClick(() => {
   *         router.pushUrl({ url: 'pages/Detail' });
   *     })
   * ```
   */
  private handleRouterPush(
    invokeExpr: AbstractInvokeExpr,
    sourceMethod: ArkMethod,
    result: NavigationAnalysisResult,
  ): void {
    const targetUrl = this.extractRouterUrl(invokeExpr);

    if (targetUrl) {
      result.navigationTargets.push({
        targetAbilityName: targetUrl,
        targetSignature: undefined,
        sourceMethod: sourceMethod,
        navigationType: NavigationType.ROUTER_PUSH,
      });

      console.log(`[NavigationAnalyzer] Found router.pushUrl: ${targetUrl}`);
    } else {
      result.warnings.push(
        `无法解析 router.pushUrl 的目标 URL (${sourceMethod.getName()})`,
      );
    }
  }

  /**
   * 处理 router.replaceUrl({ url: 'pages/Login' })
   */
  private handleRouterReplace(
    invokeExpr: AbstractInvokeExpr,
    sourceMethod: ArkMethod,
    result: NavigationAnalysisResult,
  ): void {
    const targetUrl = this.extractRouterUrl(invokeExpr);

    if (targetUrl) {
      result.navigationTargets.push({
        targetAbilityName: targetUrl,
        targetSignature: undefined,
        sourceMethod: sourceMethod,
        navigationType: NavigationType.ROUTER_REPLACE,
      });

      console.log(`[NavigationAnalyzer] Found router.replaceUrl: ${targetUrl}`);
    } else {
      result.warnings.push(
        `无法解析 router.replaceUrl 的目标 URL (${sourceMethod.getName()})`,
      );
    }
  }

  /**
   * 处理 router.back()
   */
  private handleRouterBack(
    invokeExpr: AbstractInvokeExpr,
    sourceMethod: ArkMethod,
    result: NavigationAnalysisResult,
  ): void {
    result.navigationTargets.push({
      targetAbilityName: "__BACK__", // 特殊标记
      targetSignature: undefined,
      sourceMethod: sourceMethod,
      navigationType: NavigationType.ROUTER_BACK,
    });

    console.log(`[NavigationAnalyzer] Found router.back`);
  }

  /**
   * 处理 NavPathStack.pushPath(info) / NavPathStack.replacePath(info)
   *
   * `info` 是 NavPathInfo 对象，其 `name` 字段为目标页面名称：
   * ```typescript
   * this.pageStack.pushPath({ name: 'PageTwo' });
   * ```
   *
   * ArkAnalyzer 会将对象字面量转换为匿名类，需要从 `name` 字段中提取目标页面名。
   */
  private handleNavPathStackWithInfo(
    invokeExpr: AbstractInvokeExpr,
    sourceMethod: ArkMethod,
    result: NavigationAnalysisResult,
    methodName: string,
  ): void {
    const targetName = this.extractNavPathInfoName(invokeExpr);
    const navType =
      methodName === NAVIGATION_METHOD_NAMES.REPLACE_PATH
        ? NavigationType.ROUTER_REPLACE
        : NavigationType.ROUTER_PUSH;

    if (targetName) {
      result.navigationTargets.push({
        targetAbilityName: targetName,
        targetSignature: undefined,
        sourceMethod,
        navigationType: navType,
      });
      console.log(
        `[NavigationAnalyzer] Found NavPathStack.${methodName}: ${targetName}`,
      );
    } else {
      result.warnings.push(
        `无法解析 NavPathStack.${methodName} 的目标页面 (${sourceMethod.getName()})`,
      );
    }
  }

  /**
   * 处理 NavPathStack.pushPathByName(name, param) / replacePathByName(name, param)
   *
   * 第一个参数直接是目标页面名称字符串：
   * ```typescript
   * this.pageStack.pushPathByName('PageTwo', { key: 'value' });
   * ```
   */
  private handleNavPathStackByName(
    invokeExpr: AbstractInvokeExpr,
    sourceMethod: ArkMethod,
    result: NavigationAnalysisResult,
    methodName: string,
  ): void {
    // 第一个参数是目标页面名称（字符串）
    const targetName = this.extractStringArg(invokeExpr, 0);
    const navType =
      methodName === NAVIGATION_METHOD_NAMES.REPLACE_PATH_BY_NAME
        ? NavigationType.ROUTER_REPLACE
        : NavigationType.ROUTER_PUSH;

    if (targetName) {
      result.navigationTargets.push({
        targetAbilityName: targetName,
        targetSignature: undefined,
        sourceMethod,
        navigationType: navType,
      });
      console.log(
        `[NavigationAnalyzer] Found NavPathStack.${methodName}: ${targetName}`,
      );
    } else {
      result.warnings.push(
        `无法解析 NavPathStack.${methodName} 的目标页面名 (${sourceMethod.getName()})`,
      );
    }
  }

  /**
   * 从 NavPathInfo 对象（pushPath 的参数）中提取 `name` 字段
   *
   * NavPathInfo 结构：`{ name: 'PageTwo', param?: any, ... }`
   * ArkAnalyzer 通常将字面量对象转换为匿名类，`name` 字段存储在匿名类中。
   */
  private extractNavPathInfoName(
    invokeExpr: AbstractInvokeExpr,
  ): string | null {
    const args = invokeExpr.getArgs();
    if (args.length === 0) return null;

    const firstArg = args[0];

    // 情况1: 直接是字符串（简化情况，通常不存在）
    if (
      firstArg instanceof Constant &&
      firstArg.getType() instanceof StringType
    ) {
      return firstArg.getValue();
    }

    // 情况2: Local 变量（NavPathInfo 对象）
    if (firstArg instanceof Local) {
      // 先尝试字段赋值查找 name
      const nameFromField = this.findFieldAssignment(firstArg, "name");
      if (nameFromField) return nameFromField;

      // 再尝试从对象初始化查找 name
      const nameFromInit = this.findFieldValueInInit(firstArg, "name");
      if (nameFromInit) return nameFromInit;

      // 最后尝试从匿名类查找 name 字段
      const declaringStmt = firstArg.getDeclaringStmt();
      if (declaringStmt instanceof ArkAssignStmt) {
        const rightOp = declaringStmt.getRightOp();
        if (rightOp instanceof ArkNewExpr) {
          const classType = rightOp.getClassType();
          if (classType) {
            return this.extractFieldFromAnonymousClass(classType, "name");
          }
        }
      }
    }

    return null;
  }

  /**
   * 从对象初始化过程中查找指定字段的字符串值（通用版，字段名可指定）
   */
  private findFieldValueInInit(local: Local, fieldName: string): string | null {
    const declaringStmt = local.getDeclaringStmt();
    if (!declaringStmt || !(declaringStmt instanceof ArkAssignStmt))
      return null;

    const cfg = declaringStmt.getCfg();
    if (!cfg) return null;

    let foundDeclaring = false;
    for (const block of cfg.getBlocks()) {
      for (const stmt of block.getStmts()) {
        if (stmt === declaringStmt) {
          foundDeclaring = true;
          continue;
        }
        if (foundDeclaring && stmt instanceof ArkAssignStmt) {
          const leftOp = stmt.getLeftOp();
          if (leftOp instanceof ArkInstanceFieldRef) {
            const base = leftOp.getBase();
            if (
              base.getName() === local.getName() &&
              leftOp.getFieldName() === fieldName
            ) {
              const rightOp = stmt.getRightOp();
              if (
                rightOp instanceof Constant &&
                rightOp.getType() instanceof StringType
              ) {
                return rightOp.getValue();
              }
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * 从匿名类中提取指定字段的字符串常量值（通用版，字段名可指定）
   */
  private extractFieldFromAnonymousClass(
    classType: ClassType,
    fieldName: string,
  ): string | null {
    const arkClass = this.scene.getClass(classType.getClassSignature());
    if (!arkClass) return null;

    for (const field of arkClass.getFields()) {
      if (field.getName() === fieldName) {
        const initializer = field.getInitializer();
        if (initializer instanceof ArkAssignStmt) {
          const rightOp = initializer.getRightOp();
          if (
            rightOp instanceof Constant &&
            rightOp.getType() instanceof StringType
          ) {
            return rightOp.getValue();
          }
          // 尝试从字符串中匹配
          const initStr = initializer.toString();
          const match = initStr.match(/=\s*'([^']+)'/);
          if (match) return match[1];
        }
      }
    }
    return null;
  }

  /**
   * 处理 context.startAbility(want)
   *
   * Want 对象结构：
   * ```typescript
   * let want: Want = {
   *     bundleName: 'com.example.app',
   *     abilityName: 'SecondAbility'
   * };
   * this.context.startAbility(want);
   * ```
   */
  private handleStartAbility(
    invokeExpr: AbstractInvokeExpr,
    sourceMethod: ArkMethod,
    result: NavigationAnalysisResult,
  ): void {
    // startAbility 的参数是一个 Want 对象
    // 需要分析这个对象的属性来获取目标 Ability
    const targetAbility = this.extractWantTarget(invokeExpr, sourceMethod);

    if (targetAbility) {
      result.navigationTargets.push({
        targetAbilityName: targetAbility,
        targetSignature: undefined,
        sourceMethod: sourceMethod,
        navigationType: NavigationType.START_ABILITY,
      });

      console.log(`[NavigationAnalyzer] Found startAbility: ${targetAbility}`);
    } else {
      result.warnings.push(
        `无法解析 startAbility 的目标 Ability (${sourceMethod.getName()})`,
      );
    }
  }

  // ========================================================================
  // 私有方法：参数解析
  // ========================================================================

  /**
   * 从调用表达式中提取字符串参数
   *
   * @param invokeExpr 调用表达式
   * @param argIndex 参数索引
   * @returns 字符串值（如果能解析到）
   */
  private extractStringArg(
    invokeExpr: AbstractInvokeExpr,
    argIndex: number,
  ): string | null {
    const args = invokeExpr.getArgs();
    if (argIndex >= args.length) {
      return null;
    }

    const arg = args[argIndex];

    // 直接是字符串常量
    if (arg instanceof Constant && arg.getType() instanceof StringType) {
      return arg.getValue();
    }

    // TODO: 处理变量的情况，需要数据流分析
    // 目前只处理常量情况

    return null;
  }

  /**
   * 从 router.pushUrl/replaceUrl 调用中提取目标 URL
   *
   * 支持以下几种情况：
   * 1. router.pushUrl({ url: 'pages/Detail' })  - 对象字面量
   * 2. router.pushUrl(options)                   - 变量引用
   * 3. router.pushUrl('pages/Detail')           - 直接字符串（简化情况）
   *
   * 解析流程：
   * ```
   * ┌─────────────────────────────────────────────────────────────┐
   * │  参数类型判断                                                │
   * │      │                                                      │
   * │      ├─→ Constant (字符串) → 直接返回值                      │
   * │      │                                                      │
   * │      └─→ Local (变量) → 追踪定义语句                         │
   * │              │                                              │
   * │              ▼                                              │
   * │         查找 declaringStmt                                  │
   * │              │                                              │
   * │              ▼                                              │
   * │         分析 rightOp → 查找 url 属性的赋值                   │
   * └─────────────────────────────────────────────────────────────┘
   * ```
   */
  private extractRouterUrl(invokeExpr: AbstractInvokeExpr): string | null {
    const args = invokeExpr.getArgs();
    if (args.length === 0) {
      return null;
    }

    const firstArg = args[0];

    // 情况1: 直接传入字符串（简化情况）
    if (
      firstArg instanceof Constant &&
      firstArg.getType() instanceof StringType
    ) {
      return firstArg.getValue();
    }

    // 情况2: 传入 Local 变量
    if (firstArg instanceof Local) {
      return this.extractUrlFromLocalObject(firstArg);
    }

    return null;
  }

  /**
   * 从 Local 对象中提取 url 属性值
   *
   * 处理形如：
   * ```typescript
   * let options = { url: 'pages/Detail' };
   * router.pushUrl(options);
   * ```
   *
   * 或者：
   * ```typescript
   * let options: RouterOptions = new RouterOptions();
   * options.url = 'pages/Detail';
   * router.pushUrl(options);
   * ```
   */
  private extractUrlFromLocalObject(local: Local): string | null {
    const localName = local.getName();
    console.log(`[NavigationAnalyzer] Extracting url from Local: ${localName}`);

    // 获取变量的定义语句
    const declaringStmt = local.getDeclaringStmt();
    if (!declaringStmt) {
      console.log(`[NavigationAnalyzer] No declaring stmt for ${localName}`);
      return null;
    }

    // 如果定义语句是赋值语句，分析右操作数
    if (declaringStmt instanceof ArkAssignStmt) {
      const rightOp = declaringStmt.getRightOp();

      // 情况2a: 右操作数是另一个 Local（可能是参数或其他变量）
      if (rightOp instanceof Local) {
        // 递归追踪
        return this.extractUrlFromLocalObject(rightOp);
      }

      // 情况2b: 右操作数是 new 表达式（对象字面量被转换为匿名类）
      // 例如: %0 = new %AC1$DynamicRouter.goToPage1
      if (rightOp instanceof ArkNewExpr) {
        const classType = rightOp.getClassType();
        if (classType) {
          const url = this.extractUrlFromAnonymousClass(classType);
          if (url) {
            return url;
          }
        }
      }
    }

    // 查找对该对象 url 属性的赋值
    // 遍历 usedStmts 查找 obj.url = 'xxx' 形式的赋值
    const urlValue = this.findFieldAssignment(local, "url");
    if (urlValue) {
      return urlValue;
    }

    // 尝试从对象的初始化过程中查找
    return this.findUrlInObjectInitialization(local);
  }

  /**
   * 查找对象字段的赋值语句
   *
   * 查找形如 obj.fieldName = 'value' 的语句
   */
  private findFieldAssignment(local: Local, fieldName: string): string | null {
    // 获取该变量被使用的所有语句
    const usedStmts = local.getUsedStmts();

    for (const stmt of usedStmts) {
      if (stmt instanceof ArkAssignStmt) {
        const leftOp = stmt.getLeftOp();

        // 检查是否是字段赋值 obj.url = xxx
        if (leftOp instanceof ArkInstanceFieldRef) {
          const base = leftOp.getBase();
          const field = leftOp.getFieldName();

          if (base.getName() === local.getName() && field === fieldName) {
            const rightOp = stmt.getRightOp();
            if (
              rightOp instanceof Constant &&
              rightOp.getType() instanceof StringType
            ) {
              console.log(
                `[NavigationAnalyzer] Found field assignment: ${local.getName()}.${fieldName} = '${rightOp.getValue()}'`,
              );
              return rightOp.getValue();
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * 从对象初始化过程中查找 url 值
   *
   * 处理对象字面量的情况，ArkAnalyzer 可能将其转换为多个语句
   */
  private findUrlInObjectInitialization(local: Local): string | null {
    const declaringStmt = local.getDeclaringStmt();
    if (!declaringStmt || !(declaringStmt instanceof ArkAssignStmt)) {
      return null;
    }

    // 获取所在方法的 CFG
    const cfg = declaringStmt.getCfg();
    if (!cfg) {
      return null;
    }

    // 遍历 CFG 中该定义语句之后的语句，查找字段赋值
    let foundDeclaring = false;
    for (const block of cfg.getBlocks()) {
      for (const stmt of block.getStmts()) {
        if (stmt === declaringStmt) {
          foundDeclaring = true;
          continue;
        }

        if (foundDeclaring && stmt instanceof ArkAssignStmt) {
          const leftOp = stmt.getLeftOp();
          if (leftOp instanceof ArkInstanceFieldRef) {
            const base = leftOp.getBase();
            const fieldName = leftOp.getFieldName();

            if (base.getName() === local.getName() && fieldName === "url") {
              const rightOp = stmt.getRightOp();
              if (
                rightOp instanceof Constant &&
                rightOp.getType() instanceof StringType
              ) {
                console.log(
                  `[NavigationAnalyzer] Found url in init: ${rightOp.getValue()}`,
                );
                return rightOp.getValue();
              }
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * 从匿名类（对象字面量生成的）中提取 url 字段值
   *
   * 当代码为 `router.pushUrl({ url: 'pages/Page1' })` 时，
   * ArkAnalyzer 会将对象字面量转换为匿名类：
   *
   * ```
   * %0 = new %AC1$DynamicRouter.goToPage1
   * instanceinvoke router.pushUrl(%0)
   * ```
   *
   * url 值存储在匿名类的字段初始值中：
   *
   * ```
   * 类: %AC1$DynamicRouter.goToPage1
   * 字段: url: string
   * 初始值: this.url = 'pages/Page1'
   * ```
   */
  private extractUrlFromAnonymousClass(classType: ClassType): string | null {
    const className = classType.getClassSignature().getClassName();
    console.log(
      `[NavigationAnalyzer] Extracting url from anonymous class: ${className}`,
    );

    // 获取匿名类
    const arkClass = this.scene.getClass(classType.getClassSignature());
    if (!arkClass) {
      console.log(
        `[NavigationAnalyzer] Anonymous class not found: ${className}`,
      );
      return null;
    }

    // 查找 url 字段
    for (const field of arkClass.getFields()) {
      if (field.getName() === "url") {
        // 获取字段的初始值
        const initializer = field.getInitializer();
        if (initializer) {
          // 初始值是一个 Stmt，通常是 ArkAssignStmt
          // 格式: this.<...>.url = 'pages/Page1'
          if (initializer instanceof ArkAssignStmt) {
            const rightOp = initializer.getRightOp();
            if (
              rightOp instanceof Constant &&
              rightOp.getType() instanceof StringType
            ) {
              const urlValue = rightOp.getValue();
              console.log(
                `[NavigationAnalyzer] Found url in anonymous class field: ${urlValue}`,
              );
              return urlValue;
            }
          }

          // 尝试从初始值字符串中提取
          const initStr = initializer.toString();
          console.log(`[NavigationAnalyzer] Field initializer: ${initStr}`);

          // 匹配形如 "this.url = 'pages/xxx'" 的模式
          const match = initStr.match(/=\s*'([^']+)'/);
          if (match) {
            console.log(
              `[NavigationAnalyzer] Extracted url from initializer string: ${match[1]}`,
            );
            return match[1];
          }
        }
      }
    }

    console.log(`[NavigationAnalyzer] No url field found in anonymous class`);
    return null;
  }

  /**
   * 从 startAbility(want) 调用中提取目标 Ability
   *
   * Want 对象结构：
   * ```typescript
   * let want: Want = {
   *     bundleName: 'com.example.app',
   *     abilityName: 'SecondAbility'
   * };
   * ```
   *
   * 解析流程：
   * ```
   * ┌─────────────────────────────────────────────────────────────┐
   * │  startAbility(want)                                         │
   * │      │                                                      │
   * │      ▼                                                      │
   * │  want 是 Local → 追踪定义                                   │
   * │      │                                                      │
   * │      ▼                                                      │
   * │  查找 want.abilityName 的赋值                               │
   * │      │                                                      │
   * │      ▼                                                      │
   * │  返回 abilityName 值                                        │
   * └─────────────────────────────────────────────────────────────┘
   * ```
   */
  private extractWantTarget(
    invokeExpr: AbstractInvokeExpr,
    sourceMethod: ArkMethod,
  ): string | null {
    const args = invokeExpr.getArgs();
    if (args.length === 0) {
      return null;
    }

    const wantArg = args[0];

    if (wantArg instanceof Local) {
      console.log(
        `[NavigationAnalyzer] Extracting Want target from Local: ${wantArg.getName()}`,
      );

      // 优先查找 abilityName 字段
      const abilityName = this.findFieldAssignment(wantArg, "abilityName");
      if (abilityName) {
        return abilityName;
      }

      // 如果没找到，尝试从初始化过程中查找
      return this.findAbilityNameInWantInit(wantArg);
    }

    return null;
  }

  /**
   * 从 Want 对象初始化中查找 abilityName
   */
  private findAbilityNameInWantInit(local: Local): string | null {
    const declaringStmt = local.getDeclaringStmt();
    if (!declaringStmt || !(declaringStmt instanceof ArkAssignStmt)) {
      return null;
    }

    const cfg = declaringStmt.getCfg();
    if (!cfg) {
      return null;
    }

    // 遍历查找 abilityName 字段赋值
    let foundDeclaring = false;
    for (const block of cfg.getBlocks()) {
      for (const stmt of block.getStmts()) {
        if (stmt === declaringStmt) {
          foundDeclaring = true;
          continue;
        }

        if (foundDeclaring && stmt instanceof ArkAssignStmt) {
          const leftOp = stmt.getLeftOp();
          if (leftOp instanceof ArkInstanceFieldRef) {
            const base = leftOp.getBase();
            const fieldName = leftOp.getFieldName();

            // 查找 abilityName 或 bundleName
            if (base.getName() === local.getName()) {
              if (fieldName === "abilityName") {
                const rightOp = stmt.getRightOp();
                if (
                  rightOp instanceof Constant &&
                  rightOp.getType() instanceof StringType
                ) {
                  console.log(
                    `[NavigationAnalyzer] Found abilityName: ${rightOp.getValue()}`,
                  );
                  return rightOp.getValue();
                }
              }
            }
          }
        }
      }
    }

    return null;
  }

  // ========================================================================
  // 工具方法
  // ========================================================================

  /**
   * 根据页面路径查找对应的 ComponentInfo
   *
   * @param pagePath 页面路径（如 'pages/Index'）
   * @returns ComponentInfo（如果找到）
   */
  public findComponentByPath(pagePath: string): ComponentInfo | undefined {
    // 尝试直接匹配
    if (this.componentMap.has(pagePath)) {
      return this.componentMap.get(pagePath);
    }

    // 尝试提取最后一部分（如 'pages/Index' -> 'Index'）
    const parts = pagePath.split("/");
    const lastPart = parts[parts.length - 1];
    if (this.componentMap.has(lastPart)) {
      return this.componentMap.get(lastPart);
    }

    return undefined;
  }
}

// ============================================================================
// 导出辅助函数
// ============================================================================

/**
 * 快速分析一个类的路由关系
 */
export function analyzeNavigation(
  scene: Scene,
  arkClass: ArkClass,
  components?: ComponentInfo[],
): NavigationAnalysisResult {
  const analyzer = new NavigationAnalyzer(scene);
  if (components) {
    analyzer.setComponentMap(components);
  }
  return analyzer.analyzeClass(arkClass);
}
