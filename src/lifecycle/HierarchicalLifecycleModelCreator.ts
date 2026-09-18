/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

import {
  ArkBody,
  ArkConditionExpr,
  ArkIfStmt,
  ArkMethod,
  ArkReturnVoidStmt,
  BasicBlock,
  Cfg,
  Local,
  RelationalBinaryOperator,
  ValueUtil,
} from "../adapter/arkanalyzer";
import { LifecycleModelCreator } from "./LifecycleModelCreator";
import {
  AbilityInfo,
  AbilityLifecycleMethodStage,
  AbilityLifecycleStage,
  ComponentInfo,
  ComponentLifecycleStage,
  NavigationType,
  UICallbackInfo,
} from "./LifecycleTypes";

const ABILITY_START_STAGES = new Set<AbilityLifecycleMethodStage>([
  AbilityLifecycleStage.CREATE,
  AbilityLifecycleStage.WINDOW_STAGE_CREATE,
]);

const ABILITY_END_STAGES = new Set<AbilityLifecycleMethodStage>([
  AbilityLifecycleStage.WINDOW_STAGE_WILL_DESTROY,
  AbilityLifecycleStage.WINDOW_STAGE_DESTROY,
  AbilityLifecycleStage.DESTROY,
]);

const COMPONENT_PAGE_SCOPE_STAGES: ComponentLifecycleStage[] = [
  ComponentLifecycleStage.WILL_APPLY_THEME,
  ComponentLifecycleStage.BUILD,
  ComponentLifecycleStage.DID_BUILD,
  ComponentLifecycleStage.BACK_PRESS,
  ComponentLifecycleStage.KEY_EVENT,
];

/**
 * M1 lifecycle model with compact scope dispatchers.
 *
 * A scope head links directly to concrete callback blocks, and callbacks return
 * to that head. Ability-owned components stay inside their Ability scope;
 * components with no resolved owner remain in a conservative standalone scope.
 */
export class HierarchicalLifecycleModelCreator extends LifecycleModelCreator {
  protected override buildDummyMainCfg(): void {
    this.retainReachableModelElements();

    const cfg = new Cfg();
    cfg.setDeclaringMethod(this.dummyMain);

    const entryBlock = new BasicBlock();
    cfg.addBlock(entryBlock);
    this.addStaticInitialization(cfg, entryBlock);
    this.addClassInstances(entryBlock);
    this.addAbilityStages(entryBlock, ABILITY_START_STAGES);
    this.addComponentStage(entryBlock, ComponentLifecycleStage.ABOUT_TO_APPEAR);

    const abilityHead = this.createDispatchHead(cfg, entryBlock);
    const ownedComponentSignatures = new Set<string>();

    for (const ability of this.abilities) {
      const components = this.uniqueComponents(ability.components);
      for (const component of components) {
        ownedComponentSignatures.add(component.signature.toString());
      }

      const foreground = ability.lifecycleMethods.get(
        AbilityLifecycleStage.FOREGROUND,
      );
      let scopeEntry = abilityHead;
      if (foreground) {
        scopeEntry = this.addMethodDispatch(
          cfg,
          abilityHead,
          [[this.getOrCreateClassInstance(ability.arkClass), foreground]],
        )!;
      }

      if (components.length > 0) {
        const pageHead = this.buildPageScope(cfg, scopeEntry, components);
        this.linkBlocks(pageHead, abilityHead);
      } else if (scopeEntry !== abilityHead) {
        this.linkBlocks(scopeEntry, abilityHead);
      }

      this.addAbilityStageDispatch(
        cfg,
        abilityHead,
        ability,
        AbilityLifecycleStage.BACKGROUND,
      );
      for (const invocation of this.otherAbilityMethods(ability)) {
        this.addReturningMethodDispatch(cfg, abilityHead, [invocation]);
      }
    }

    const orphanComponents = this.uniqueComponents().filter(component =>
      !ownedComponentSignatures.has(component.signature.toString())
    );
    if (orphanComponents.length > 0) {
      const pageHead = this.buildPageScope(
        cfg,
        abilityHead,
        orphanComponents,
      );
      this.linkBlocks(pageHead, abilityHead);
    }

    const returnBlock = new BasicBlock();
    this.addComponentStage(
      returnBlock,
      ComponentLifecycleStage.ABOUT_TO_DISAPPEAR,
    );
    this.addAbilityStages(returnBlock, ABILITY_END_STAGES);
    returnBlock.addStmt(new ArkReturnVoidStmt());
    cfg.addBlock(returnBlock);
    this.linkBlocks(abilityHead, returnBlock);

    this.dummyMain.setBody(
      new ArkBody(new Set(this.classInstanceMap.values()), cfg),
    );
    this.linkStmtsToCfg(cfg);
  }

  private buildPageScope(
    cfg: Cfg,
    predecessor: BasicBlock,
    components: readonly ComponentInfo[],
  ): BasicBlock {
    const pageHead = this.createDispatchHead(cfg, predecessor);
    const visibleEntry = this.addMethodDispatch(
      cfg,
      pageHead,
      this.componentStageInvocations(
        components,
        ComponentLifecycleStage.PAGE_SHOW,
      ),
    ) ?? pageHead;
    const eventHead = this.buildVisibleEventScope(
      cfg,
      visibleEntry,
      components,
    );
    this.linkBlocks(eventHead, pageHead);

    this.addReturningMethodDispatch(
      cfg,
      pageHead,
      this.componentStageInvocations(
        components,
        ComponentLifecycleStage.PAGE_HIDE,
      ),
    );

    for (const component of components) {
      const instance = this.getOrCreateClassInstance(component.arkClass);
      for (const stage of COMPONENT_PAGE_SCOPE_STAGES) {
        const method = component.lifecycleMethods.get(stage);
        if (method) {
          this.addReturningMethodDispatch(
            cfg,
            pageHead,
            [[instance, method]],
          );
        }
      }

      const reusePair: Array<[Local, ArkMethod]> = [];
      const recycle = component.lifecycleMethods.get(
        ComponentLifecycleStage.ABOUT_TO_RECYCLE,
      );
      const reuse = component.lifecycleMethods.get(
        ComponentLifecycleStage.ABOUT_TO_REUSE,
      );
      if (recycle) reusePair.push([instance, recycle]);
      if (reuse) reusePair.push([instance, reuse]);
      this.addReturningMethodDispatch(cfg, pageHead, reusePair);
    }

    return pageHead;
  }

  private buildVisibleEventScope(
    cfg: Cfg,
    predecessor: BasicBlock,
    components: readonly ComponentInfo[],
  ): BasicBlock {
    const eventHead = this.createDispatchHead(cfg, predecessor);
    if (!this.config.enableFineGrainedUICallbacks) return eventHead;

    for (const component of components) {
      const instance = this.getOrCreateClassInstance(component.arkClass);
      for (const callback of component.uiCallbacks) {
        const callbackBlock = this.addCallbackDispatch(
          cfg,
          eventHead,
          instance,
          callback,
        );
        this.linkBlocks(callbackBlock, eventHead);
      }
    }
    return eventHead;
  }

  /**
   * Keep configured entry Abilities and their statically resolved startAbility
   * closure. An unresolved startAbility target disables pruning for soundness.
   */
  private retainReachableModelElements(): void {
    const allAbilities = this.abilities;
    const entries = allAbilities.filter(ability => ability.isEntry);
    if (entries.length === 0) return;

    const byName = new Map(
      allAbilities.map(ability => [ability.name.toLowerCase(), ability]),
    );
    const reachable = new Set<AbilityInfo>();
    const pending = [...entries];
    while (pending.length > 0) {
      const ability = pending.pop()!;
      if (reachable.has(ability)) continue;
      reachable.add(ability);
      if (ability.hasUnresolvedAbilityNavigation) return;
      for (const target of ability.navigationTargets) {
        if (target.navigationType !== NavigationType.START_ABILITY) continue;
        const targetName = target.targetAbilityName
          .split(/[/.]/)
          .filter(Boolean)
          .at(-1)
          ?.toLowerCase();
        const targetAbility = targetName ? byName.get(targetName) : undefined;
        if (targetAbility && !reachable.has(targetAbility)) {
          pending.push(targetAbility);
        }
      }
    }

    const allOwned = new Set(
      allAbilities.flatMap(ability =>
        ability.components.map(component => component.signature.toString())
      ),
    );
    const reachableOwned = new Set(
      [...reachable].flatMap(ability =>
        ability.components.map(component => component.signature.toString())
      ),
    );
    this.abilities = allAbilities.filter(ability => reachable.has(ability));
    this.components = this.components.filter(component => {
      const signature = component.signature.toString();
      return !allOwned.has(signature) || reachableOwned.has(signature);
    });
  }

  private addClassInstances(entryBlock: BasicBlock): void {
    for (const ability of this.abilities) {
      const local = this.getOrCreateClassInstance(ability.arkClass);
      this.addInstanceCreation(entryBlock, local, ability.arkClass);
    }
    for (const component of this.uniqueComponents()) {
      const local = this.getOrCreateClassInstance(component.arkClass);
      this.addInstanceCreation(entryBlock, local, component.arkClass);
    }
  }

  private addAbilityStage(
    block: BasicBlock,
    stage: AbilityLifecycleMethodStage,
  ): void {
    for (const ability of this.abilities) {
      const method = ability.lifecycleMethods.get(stage);
      if (method) {
        this.addMethodInvocation(
          block,
          this.getOrCreateClassInstance(ability.arkClass),
          method,
        );
      }
    }
  }

  private addAbilityStageDispatch(
    cfg: Cfg,
    dispatcher: BasicBlock,
    ability: AbilityInfo,
    stage: AbilityLifecycleMethodStage,
  ): void {
    const method = ability.lifecycleMethods.get(stage);
    if (!method) return;
    this.addReturningMethodDispatch(
      cfg,
      dispatcher,
      [[this.getOrCreateClassInstance(ability.arkClass), method]],
    );
  }

  private addAbilityStages(
    block: BasicBlock,
    stages: ReadonlySet<AbilityLifecycleMethodStage>,
  ): void {
    for (const stage of this.config.lifecycleOrder) {
      if (stages.has(stage)) this.addAbilityStage(block, stage);
    }
  }

  private addComponentStage(
    block: BasicBlock,
    stage: ComponentLifecycleStage,
    components: readonly ComponentInfo[] = this.uniqueComponents(),
  ): void {
    for (const [instance, method] of this.componentStageInvocations(
      components,
      stage,
    )) {
      this.addMethodInvocation(block, instance, method);
    }
  }

  private componentStageInvocations(
    components: readonly ComponentInfo[],
    stage: ComponentLifecycleStage,
  ): Array<[Local, ArkMethod]> {
    const result: Array<[Local, ArkMethod]> = [];
    for (const component of components) {
      const method = component.lifecycleMethods.get(stage);
      if (method) {
        result.push([
          this.getOrCreateClassInstance(component.arkClass),
          method,
        ]);
      }
    }
    return result;
  }

  private otherAbilityMethods(ability: AbilityInfo): Array<[Local, ArkMethod]> {
    const result: Array<[Local, ArkMethod]> = [];
    const emitted = new Set<string>();
    const instance = this.getOrCreateClassInstance(ability.arkClass);
    for (const stage of this.config.lifecycleOrder) {
      if (ABILITY_START_STAGES.has(stage) || ABILITY_END_STAGES.has(stage) ||
        stage === AbilityLifecycleStage.FOREGROUND ||
        stage === AbilityLifecycleStage.BACKGROUND) {
        continue;
      }
      const method = ability.lifecycleMethods.get(stage);
      const signature = method?.getSignature().toString();
      if (!method || !signature || emitted.has(signature)) continue;
      emitted.add(signature);
      result.push([instance, method]);
    }
    return result;
  }

  private addReturningMethodDispatch(
    cfg: Cfg,
    dispatcher: BasicBlock,
    invocations: Array<[Local, ArkMethod]>,
  ): void {
    const invocationBlock = this.addMethodDispatch(
      cfg,
      dispatcher,
      invocations,
    );
    if (invocationBlock) this.linkBlocks(invocationBlock, dispatcher);
  }

  private addMethodDispatch(
    cfg: Cfg,
    dispatcher: BasicBlock,
    invocations: Array<[Local, ArkMethod]>,
  ): BasicBlock | undefined {
    if (invocations.length === 0) return undefined;
    const invokeBlock = new BasicBlock();
    for (const [instance, method] of invocations) {
      this.addMethodInvocation(invokeBlock, instance, method);
    }
    cfg.addBlock(invokeBlock);
    this.linkBlocks(dispatcher, invokeBlock);
    return invokeBlock;
  }

  private addCallbackDispatch(
    cfg: Cfg,
    dispatcher: BasicBlock,
    instance: Local,
    callback: UICallbackInfo,
  ): BasicBlock {
    const callbackBlock = new BasicBlock();
    this.addUICallbackInvocation(callbackBlock, instance, callback);
    cfg.addBlock(callbackBlock);
    this.linkBlocks(dispatcher, callbackBlock);
    return callbackBlock;
  }

  private createDispatchHead(cfg: Cfg, predecessor: BasicBlock): BasicBlock {
    const block = new BasicBlock();
    block.addStmt(
      new ArkIfStmt(
        new ArkConditionExpr(
          ValueUtil.getBooleanConstant(true),
          ValueUtil.getBooleanConstant(false),
          RelationalBinaryOperator.InEquality,
        ),
      ),
    );
    cfg.addBlock(block);
    this.linkBlocks(predecessor, block);
    return block;
  }

  private uniqueComponents(
    components: readonly ComponentInfo[] = this.components,
  ): ComponentInfo[] {
    const seen = new Set<string>();
    return components.filter(component => {
      const signature = component.signature.toString();
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
  }

  private linkBlocks(from: BasicBlock, to: BasicBlock): void {
    from.addSuccessorBlock(to);
    to.addPredecessorBlock(from);
  }
}
