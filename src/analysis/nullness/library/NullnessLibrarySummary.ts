/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import { Stmt } from '../../../adapter/arkanalyzer';
import { NullnessFact } from '../NullnessFact';

/** A small, call-to-return model for one family of library APIs. */
export interface NullnessLibrarySummary {
    readonly id: string;

    matches(callStmt: Stmt): boolean;

    /**
     * Returns facts generated in addition to the ordinary call-to-return flow.
     * Existing facts are still killed or propagated by NullnessProblem.
     */
    getCallToReturnFacts(callStmt: Stmt, inputFact: NullnessFact): Set<NullnessFact>;

    /** Argument positions whose API contract requires a non-nullish value. */
    getNonNullArgumentIndices?(callStmt: Stmt): readonly number[];

    /** Whether a non-null call contract makes callee literal-null exits infeasible. */
    suppressesLiteralReturns?(callStmt: Stmt): boolean;
}
