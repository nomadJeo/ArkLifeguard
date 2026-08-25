/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import { Stmt } from '../../../adapter/arkanalyzer';
import type { Scene } from '../../../adapter/arkanalyzer';
import { NullnessFact } from '../NullnessFact';
import { AsyncBoundarySummary } from './AsyncBoundarySummary';
import { ArkUiArgumentSummary } from './ArkUiArgumentSummary';
import { ContainerLibrarySummary, SdkReturnTypeSummary } from './ContainerLibrarySummary';
import { NullnessLibrarySummary } from './NullnessLibrarySummary';
import { ProjectMethodReturnSummary } from './ProjectMethodReturnSummary';

/** Ordered registry for library summaries. The first matching summary owns a call. */
export class NullnessLibraryRegistry {
    private readonly summaryCache = new WeakMap<Stmt, NullnessLibrarySummary | null>();
    private readonly nonNullArgumentCache = new WeakMap<Stmt, readonly number[]>();

    constructor(private readonly summaries: readonly NullnessLibrarySummary[]) {}

    static createDefault(scene?: Scene): NullnessLibraryRegistry {
        return new NullnessLibraryRegistry([
            ...(scene ? [new ProjectMethodReturnSummary(scene)] : []),
            new ArkUiArgumentSummary(),
            new ContainerLibrarySummary(),
            new AsyncBoundarySummary(),
            new SdkReturnTypeSummary(),
        ]);
    }

    find(callStmt: Stmt): NullnessLibrarySummary | undefined {
        const cached = this.summaryCache.get(callStmt);
        if (cached !== undefined) return cached ?? undefined;
        const summary = this.summaries.find(candidate => candidate.matches(callStmt)) ?? null;
        this.summaryCache.set(callStmt, summary);
        return summary ?? undefined;
    }

    getCallToReturnFacts(callStmt: Stmt, inputFact: NullnessFact): Set<NullnessFact> {
        return this.find(callStmt)?.getCallToReturnFacts(callStmt, inputFact) ?? new Set();
    }

    getNonNullArgumentIndices(callStmt: Stmt): readonly number[] {
        const cached = this.nonNullArgumentCache.get(callStmt);
        if (cached) return cached;
        const indices = new Set<number>();
        for (const summary of this.summaries) {
            if (!summary.getNonNullArgumentIndices) continue;
            if (!summary.matches(callStmt)) continue;
            for (const index of summary.getNonNullArgumentIndices(callStmt)) {
                indices.add(index);
            }
        }
        const result = [...indices];
        this.nonNullArgumentCache.set(callStmt, result);
        return result;
    }

    shouldSuppressLiteralReturn(callStmt: Stmt, zeroFact: NullnessFact): boolean {
        const summary = this.find(callStmt);
        if (!summary) return false;
        if ([...summary.getCallToReturnFacts(callStmt, zeroFact)]
            .some(fact => !fact.isZeroFact())) {
            return true;
        }
        return summary.suppressesLiteralReturns?.(callStmt) ?? false;
    }
}
