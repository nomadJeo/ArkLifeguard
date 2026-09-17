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

const COMPONENT_LOOP_STAGES: ComponentLifecycleStage[] = [
  ComponentLifecycleStage.WILL_APPLY_THEME,
  ComponentLifecycleStage.BUILD,
  ComponentLifecycleStage.DID_BUILD,
  ComponentLifecycleStage.PAGE_SHOW,
  ComponentLifecycleStage.BACK_PRESS,
  ComponentLifecycleStage.KEY_EVENT,
  ComponentLifecycleStage.PAGE_HIDE,
];

/**
 * FlowDroid/HomeFlow-style lifecycle model.
 *
 * The generated CFG is finite, but contains a back edge around lifecycle and
 * UI callback branches:
 *
 * entry(create/appear) -> loop -> one callback branch -> loop
 *                           |                            |
 *                           +------> destroy/return <----+
 */
export class BackEdgeLifecycleModelCreator extends LifecycleModelCreator {
  protected override buildDummyMainCfg(): void {
    const cfg = new Cfg();
    cfg.setDeclaringMethod(this.dummyMain);

    const entryBlock = new BasicBlock();
    cfg.addBlock(entryBlock);
    this.addStaticInitialization(cfg, entryBlock);

    this.addClassInstances(entryBlock);
    this.addAbilityStartInvocations(entryBlock);
    this.addComponentStartInvocations(entryBlock);

    const countLocal = new Local("count", NumberType.getInstance());
    const countAssignStmt = new ArkAssignStmt(
      countLocal,
      ValueUtil.getOrCreateNumberConst(0),
    );
    entryBlock.addStmt(countAssignStmt);

    const loopBlock = new BasicBlock();
    const loopCondition = new ArkConditionExpr(
      ValueUtil.getBooleanConstant(true),
      ValueUtil.getBooleanConstant(false),
      RelationalBinaryOperator.InEquality,
    );
    loopBlock.addStmt(new ArkIfStmt(loopCondition));
    cfg.addBlock(loopBlock);
    this.linkBlocks(entryBlock, loopBlock);

    let branchIndex = 0;
    let lastBlocks: BasicBlock[] = [loopBlock];

    for (const ability of this.abilities) {
      const instance = this.getOrCreateClassInstance(ability.arkClass);
      const emitted = new Set<string>();
      for (const stage of this.config.lifecycleOrder) {
        if (ABILITY_START_STAGES.has(stage) || ABILITY_END_STAGES.has(stage)) {
          continue;
        }
        const method = ability.lifecycleMethods.get(stage);
        const signature = method?.getSignature().toString();
        if (!method || !signature || emitted.has(signature)) {
          continue;
        }
        emitted.add(signature);
        lastBlocks = this.addMethodBranch(
          cfg,
          lastBlocks,
          countLocal,
          branchIndex++,
          [[instance, method]],
        );
      }
    }

    for (const component of this.uniqueComponents()) {
      const instance = this.getOrCreateClassInstance(component.arkClass);
      for (const stage of COMPONENT_LOOP_STAGES) {
        const method = component.lifecycleMethods.get(stage);
        if (!method) {
          continue;
        }
        lastBlocks = this.addMethodBranch(
          cfg,
          lastBlocks,
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
        lastBlocks = this.addMethodBranch(
          cfg,
          lastBlocks,
          countLocal,
          branchIndex++,
          reusePair,
        );
      }

      if (this.config.enableFineGrainedUICallbacks) {
        for (const callback of component.uiCallbacks) {
          lastBlocks = this.addCallbackBranch(
            cfg,
            lastBlocks,
            countLocal,
            branchIndex++,
            instance,
            callback,
          );
        }
      }
    }

    for (const block of lastBlocks) {
      this.linkBlocks(block, loopBlock);
    }

    const returnBlock = new BasicBlock();
    this.addComponentEndInvocations(returnBlock);
    this.addAbilityEndInvocations(returnBlock);
    returnBlock.addStmt(new ArkReturnVoidStmt());
    cfg.addBlock(returnBlock);
    this.linkBlocks(loopBlock, returnBlock);

    this.dummyMain.setBody(
      new ArkBody(new Set(this.classInstanceMap.values()), cfg),
    );
    this.linkStmtsToCfg(cfg);
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

  private addAbilityStartInvocations(entryBlock: BasicBlock): void {
    for (const ability of this.abilities) {
      const instance = this.getOrCreateClassInstance(ability.arkClass);
      for (const stage of this.config.lifecycleOrder) {
        if (!ABILITY_START_STAGES.has(stage)) {
          continue;
        }
        const method = ability.lifecycleMethods.get(stage);
        if (method) this.addMethodInvocation(entryBlock, instance, method);
      }
    }
  }

  private addComponentStartInvocations(entryBlock: BasicBlock): void {
    for (const component of this.uniqueComponents()) {
      const method = component.lifecycleMethods.get(
        ComponentLifecycleStage.ABOUT_TO_APPEAR,
      );
      if (method) {
        this.addMethodInvocation(
          entryBlock,
          this.getOrCreateClassInstance(component.arkClass),
          method,
        );
      }
    }
  }

  private addComponentEndInvocations(returnBlock: BasicBlock): void {
    for (const component of this.uniqueComponents()) {
      const method = component.lifecycleMethods.get(
        ComponentLifecycleStage.ABOUT_TO_DISAPPEAR,
      );
      if (method) {
        this.addMethodInvocation(
          returnBlock,
          this.getOrCreateClassInstance(component.arkClass),
          method,
        );
      }
    }
  }

  private addAbilityEndInvocations(returnBlock: BasicBlock): void {
    for (const ability of this.abilities) {
      const instance = this.getOrCreateClassInstance(ability.arkClass);
      for (const stage of this.config.lifecycleOrder) {
        if (!ABILITY_END_STAGES.has(stage)) {
          continue;
        }
        const method = ability.lifecycleMethods.get(stage);
        if (method) this.addMethodInvocation(returnBlock, instance, method);
      }
    }
  }

  private addMethodBranch(
    cfg: Cfg,
    predecessors: BasicBlock[],
    countLocal: Local,
    branchIndex: number,
    invocations: Array<[Local, ArkMethod]>,
  ): BasicBlock[] {
    const { ifBlock, invokeBlock } = this.createBranchBlocks(
      cfg,
      predecessors,
      countLocal,
      branchIndex,
    );
    for (const [instance, method] of invocations) {
      this.addMethodInvocation(invokeBlock, instance, method);
    }
    return [ifBlock, invokeBlock];
  }

  private addCallbackBranch(
    cfg: Cfg,
    predecessors: BasicBlock[],
    countLocal: Local,
    branchIndex: number,
    instance: Local,
    callback: ComponentInfo["uiCallbacks"][number],
  ): BasicBlock[] {
    const { ifBlock, invokeBlock } = this.createBranchBlocks(
      cfg,
      predecessors,
      countLocal,
      branchIndex,
    );
    this.addUICallbackInvocation(invokeBlock, instance, callback);
    return [ifBlock, invokeBlock];
  }

  private createBranchBlocks(
    cfg: Cfg,
    predecessors: BasicBlock[],
    countLocal: Local,
    branchIndex: number,
  ): { ifBlock: BasicBlock; invokeBlock: BasicBlock } {
    const condition = new ArkConditionExpr(
      countLocal,
      new Constant(branchIndex.toString(), NumberType.getInstance()),
      RelationalBinaryOperator.Equality,
    );
    const ifBlock = new BasicBlock();
    ifBlock.addStmt(new ArkIfStmt(condition));
    cfg.addBlock(ifBlock);
    for (const predecessor of predecessors) {
      this.linkBlocks(predecessor, ifBlock);
    }

    const invokeBlock = new BasicBlock();
    cfg.addBlock(invokeBlock);
    this.linkBlocks(ifBlock, invokeBlock);
    return { ifBlock, invokeBlock };
  }

  private uniqueComponents(): ComponentInfo[] {
    const seen = new Set<string>();
    return this.components.filter((component) => {
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
