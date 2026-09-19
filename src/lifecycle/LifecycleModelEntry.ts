/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

import { Scene } from "../adapter/arkanalyzer";
import {
  FlatLifecycleModelCreator,
  OptimizedFlatLifecycleModelCreator,
} from "./BackEdgeLifecycleModelCreator";
import { HierarchicalLifecycleModelCreator } from "./HierarchicalLifecycleModelCreator";
import { LifecycleModelCreator } from "./LifecycleModelCreator";
import { LifecycleModelConfig } from "./LifecycleTypes";

export type LifecycleModelMode =
  | "flat"
  | "opt-flat"
  | "back-edge"
  | "hierarchical"
  | "bounded-unroll";

export const DEFAULT_LIFECYCLE_MODEL_MODE: LifecycleModelMode = "flat";

/** Selects one of the interchangeable lifecycle DummyMain implementations. */
export function createLifecycleModelCreator(
  scene: Scene,
  mode: LifecycleModelMode = DEFAULT_LIFECYCLE_MODEL_MODE,
  config?: Partial<LifecycleModelConfig>,
): LifecycleModelCreator {
  if (mode === "flat" || mode === "back-edge") {
    return new FlatLifecycleModelCreator(scene, config);
  }
  if (mode === "opt-flat") {
    return new OptimizedFlatLifecycleModelCreator(scene, config);
  }
  if (mode === "hierarchical") {
    return new HierarchicalLifecycleModelCreator(scene, config);
  }
  return new LifecycleModelCreator(scene, config);
}
