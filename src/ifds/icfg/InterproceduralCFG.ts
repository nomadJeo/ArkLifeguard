import type { ArkMethod, Stmt } from '../../adapter/arkanalyzer';

/**
 * Graph queries required by the IFDS solver.
 *
 * Implementations own CFG/call-graph indexing. The solver only consumes the
 * resulting interprocedural graph and remains responsible for fact scheduling.
 */
export interface InterproceduralCFG {
    initialize(entryMethod: ArkMethod): void;

    getNormalSuccessors(stmt: Stmt): readonly Stmt[];
    getExceptionalSuccessors(stmt: Stmt): readonly Stmt[];
    getHandlerContinuation(handler: Stmt): Stmt;

    mayThrow(stmt: Stmt): boolean;
    isCallStatement(stmt: Stmt): boolean;
    isExitStatement(stmt: Stmt): boolean;

    getAllCalleeMethods(call: Stmt): Set<ArkMethod>;
    getCalleesOfCallAt(call: Stmt): Set<ArkMethod>;
    getReturnSiteOfCallAt(call: Stmt): Stmt | null;
    getExceptionalReturnSitesOfCallAt(call: Stmt): readonly Stmt[];
    getStartPointOf(method: ArkMethod): Stmt | null;
    getStartPointOfCaller(call: Stmt): Stmt | null;
}
