/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

import {
  ArkAssignStmt,
  ArkBody,
  ArkConditionExpr,
  ArkIfStmt,
  ArkMethod,
  ArkReturnVoidStmt,
  BasicBlock,
  Cfg,
  Constant,
  Local,
  NumberType,
  RelationalBinaryOperator,
  ValueUtil,
} from "../adapter/arkanalyzer";
import { LifecycleModelCreator } from "./LifecycleModelCreator";
import {
  AbilityLifecycleMethodStage,
  AbilityLifecycleStage,
  AbilityInfo,
  ComponentInfo,
  ComponentLifecycleStage,
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
 * M1 lifecycle model.
 *
 * It separates the global Flat dispatcher into nested lifetime scopes:
 *
 * Ability dispatcher
 *   -> foreground entry
 *   -> Page dispatcher
 *      -> page-show entry
 *      -> visible UI-event dispatcher
 *
 * Dispatch inside each scope remains nondeterministic. In particular,
 * foreground and page-show callbacks may repeat; M2 is responsible for local
 * callback ordering.
 */
export class HierarchicalLifecycleModelCreator extends LifecycleModelCreator {
  protected override buildDummyMainCfg(): void {
    const cfg = new Cfg();
    cfg.setDeclaringMethod(this.dummyMain);

    const entryBlock = new BasicBlock();
    cfg.addBlock(entryBlock);
    this.addStaticInitialization(cfg, entryBlock);
    this.addClassInstances(entryBlock);
    this.addAbilityStages(entryBlock, ABILITY_START_STAGES);
    this.addComponentStage(entryBlock, ComponentLifecycleStage.ABOUT_TO_APPEAR);

    const countLocal = new Local("count", NumberType.getInstance());
    entryBlock.addStmt(
      new ArkAssignStmt(countLocal, ValueUtil.getOrCreateNumberConst(0)),
    );

    const abilityHead = this.createLoopHead(cfg, entryBlock);
    let abilityTails: BasicBlock[] = [abilityHead];
    let branchIndex = 0;

    const ownedComponentSignatures = new Set<string>();
    for (const ability of this.abilities) {
      const components = this.uniqueComponents(ability.components);
      for (const component of components) {
        ownedComponentSignatures.add(component.signature.toString());
      }

      // Each foreground branch owns one Ability and only that Ability's pages.
      // This is the M1 ownership boundary used by the nested Page/UI scopes.
      const foreground = this.createBranch(
        cfg,
        abilityTails,
        countLocal,
        branchIndex++,
      );
      this.addAbilityStageFor(
        foreground.invokeBlock,
        ability,
        AbilityLifecycleStage.FOREGROUND,
      );
      abilityTails = [foreground.ifBlock];
      if (components.length > 0) {
        const pageHead = this.buildPageScope(
          cfg,
          foreground.invokeBlock,
          countLocal,
          branchIndex,
          components,
        );
        branchIndex += this.pageBranchCount(components);
        this.linkBlocks(pageHead, abilityHead);
      } else {
        this.linkBlocks(foreground.invokeBlock, abilityHead);
      }

      const background = this.createBranch(
        cfg,
        abilityTails,
        countLocal,
        branchIndex++,
      );
      this.addAbilityStageFor(
        background.invokeBlock,
        ability,
        AbilityLifecycleStage.BACKGROUND,
      );
      this.linkBlocks(background.invokeBlock, abilityHead);
      abilityTails = [background.ifBlock];

      for (const [instance, method] of this.otherAbilityMethods(ability)) {
        abilityTails = this.addMethodBranch(
          cfg,
          abilityTails,
          countLocal,
          branchIndex++,
          [[instance, method]],
        );
      }
    }

    // Components whose loadContent owner cannot be resolved stay reachable in
    // a conservative standalone page scope instead of being assigned to every
    // Ability.
    const orphanComponents = this.uniqueComponents().filter(component =>
      !ownedComponentSignatures.has(component.signature.toString())
    );
    if (orphanComponents.length > 0) {
      const standalone = this.createBranch(
        cfg,
        abilityTails,
        countLocal,
        branchIndex++,
      );
      abilityTails = [standalone.ifBlock];
      const pageHead = this.buildPageScope(
        cfg,
        standalone.invokeBlock,
        countLocal,
        branchIndex,
        orphanComponents,
      );
      branchIndex += this.pageBranchCount(orphanComponents);
      this.linkBlocks(pageHead, abilityHead);
    }
    for (const block of abilityTails) {
      this.linkBlocks(block, abilityHead);
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
    countLocal: Local,
    firstBranchIndex: number,
    components: readonly ComponentInfo[],
  ): BasicBlock {
    const pageHead = this.createLoopHead(cfg, predecessor);
    let pageTails: BasicBlock[] = [pageHead];
    let branchIndex = firstBranchIndex;

    // Entering the visible scope always crosses onPageShow. M1 intentionally
    // permits re-entering this branch without a preceding onPageHide.
    const visible = this.createBranch(
      cfg,
      pageTails,
      countLocal,
      branchIndex++,
    );
    this.addComponentStage(
      visible.invokeBlock,
      ComponentLifecycleStage.PAGE_SHOW,
      components,
    );
    pageTails = [visible.ifBlock];
    const eventHead = this.buildVisibleEventScope(
      cfg,
      visible.invokeBlock,
      countLocal,
      branchIndex,
      components,
    );
    branchIndex += this.uiCallbackCount(components);
    this.linkBlocks(eventHead, pageHead);

    // Hiding a page returns to the Page scope. UI events are reachable only by
    // taking the visible branch again, which invokes onPageShow first.
    const hide = this.createBranch(
      cfg,
      pageTails,
      countLocal,
      branchIndex++,
    );
    this.addComponentStage(
      hide.invokeBlock,
      ComponentLifecycleStage.PAGE_HIDE,
      components,
    );
    this.linkBlocks(hide.invokeBlock, pageHead);
    pageTails = [hide.ifBlock];

    for (const component of components) {
      const instance = this.getOrCreateClassInstance(component.arkClass);
      for (const stage of COMPONENT_PAGE_SCOPE_STAGES) {
        const method = component.lifecycleMethods.get(stage);
        if (!method) continue;
        pageTails = this.addMethodBranch(
          cfg,
          pageTails,
          countLocal,
          branchIndex++,
          [[instance, method]],
        );
      }

      const recycle = component.lifecycleMethods.get(
        ComponentLifecycleStage.ABOUT_TO_RECYCLE,
      );
      const reuse = component.lifecycleMethods.get(
        ComponentLifecycleStage.ABOUT_TO_REUSE,
      );
      const reusePair: Array<[Local, ArkMethod]> = [];
      if (recycle) reusePair.push([instance, recycle]);
      if (reuse) reusePair.push([instance, reuse]);
      if (reusePair.length > 0) {
        pageTails = this.addMethodBranch(
          cfg,
          pageTails,
          countLocal,
          branchIndex++,
          reusePair,
        );
      }
    }

    for (const block of pageTails) {
      this.linkBlocks(block, pageHead);
    }
    return pageHead;
  }

  private buildVisibleEventScope(
    cfg: Cfg,
    predecessor: BasicBlock,
    countLocal: Local,
    firstBranchIndex: number,
    components: readonly ComponentInfo[],
  ): BasicBlock {
    const eventHead = this.createLoopHead(cfg, predecessor);
    let eventTails: BasicBlock[] = [eventHead];
    let branchIndex = firstBranchIndex;

    if (this.config.enableFineGrainedUICallbacks) {
      for (const component of components) {
        const instance = this.getOrCreateClassInstance(component.arkClass);
        for (const callback of component.uiCallbacks) {
          const branch = this.createBranch(
            cfg,
            eventTails,
            countLocal,
            branchIndex++,
          );
          this.addUICallbackInvocation(branch.invokeBlock, instance, callback);
          eventTails = [branch.ifBlock, branch.invokeBlock];
        }
      }
    }

    for (const block of eventTails) {
      this.linkBlocks(block, eventHead);
    }
    return eventHead;
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

  private addAbilityStageFor(
    block: BasicBlock,
    ability: AbilityInfo,
    stage: AbilityLifecycleMethodStage,
  ): void {
    const method = ability.lifecycleMethods.get(stage);
    if (method) {
      this.addMethodInvocation(
        block,
        this.getOrCreateClassInstance(ability.arkClass),
        method,
      );
    }
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
    for (const component of components) {
      const method = component.lifecycleMethods.get(stage);
      if (method) {
        this.addMethodInvocation(
          block,
          this.getOrCreateClassInstance(component.arkClass),
          method,
        );
      }
    }
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

  private addMethodBranch(
    cfg: Cfg,
    predecessors: BasicBlock[],
    countLocal: Local,
    branchIndex: number,
    invocations: Array<[Local, ArkMethod]>,
  ): BasicBlock[] {
    const branch = this.createBranch(
      cfg,
      predecessors,
      countLocal,
      branchIndex,
    );
    for (const [instance, method] of invocations) {
      this.addMethodInvocation(branch.invokeBlock, instance, method);
    }
    return [branch.ifBlock, branch.invokeBlock];
  }

  private createBranch(
    cfg: Cfg,
    predecessors: BasicBlock[],
    countLocal: Local,
    branchIndex: number,
  ): { ifBlock: BasicBlock; invokeBlock: BasicBlock } {
    const ifBlock = new BasicBlock();
    ifBlock.addStmt(
      new ArkIfStmt(
        new ArkConditionExpr(
          countLocal,
          new Constant(branchIndex.toString(), NumberType.getInstance()),
          RelationalBinaryOperator.Equality,
        ),
      ),
    );
    cfg.addBlock(ifBlock);
    for (const predecessor of predecessors) {
      this.linkBlocks(predecessor, ifBlock);
    }

    const invokeBlock = new BasicBlock();
    cfg.addBlock(invokeBlock);
    this.linkBlocks(ifBlock, invokeBlock);
    return { ifBlock, invokeBlock };
  }

  private createLoopHead(cfg: Cfg, predecessor: BasicBlock): BasicBlock {
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

  private pageBranchCount(components: readonly ComponentInfo[]): number {
    let count = 2 + this.uiCallbackCount(components);
    for (const component of components) {
      count += COMPONENT_PAGE_SCOPE_STAGES.filter(stage =>
        component.lifecycleMethods.has(stage)
      ).length;
      if (component.lifecycleMethods.has(ComponentLifecycleStage.ABOUT_TO_RECYCLE) ||
        component.lifecycleMethods.has(ComponentLifecycleStage.ABOUT_TO_REUSE)) {
        count++;
      }
    }
    return count;
  }

  private uiCallbackCount(
    components: readonly ComponentInfo[] = this.uniqueComponents(),
  ): number {
    if (!this.config.enableFineGrainedUICallbacks) return 0;
    return components.reduce(
      (sum, component) => sum + component.uiCallbacks.length,
      0,
    );
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
