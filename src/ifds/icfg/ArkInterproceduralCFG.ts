import type { ArkMethod, Scene, Stmt } from '../../adapter/arkanalyzer';
import { CallGraphManager } from './CallGraphManager';
import { CfgIndex } from './CfgIndex';
import type { InterproceduralCFG } from './InterproceduralCFG';

/** Default ICFG backed by ArkAnalyzer CFGs and a CHA call graph. */
export class ArkInterproceduralCFG implements InterproceduralCFG {
    private readonly cfgIndex: CfgIndex;
    private readonly callGraphManager: CallGraphManager;

    constructor(scene: Scene) {
        this.cfgIndex = new CfgIndex(scene);
        this.callGraphManager = new CallGraphManager(scene);
    }

    initialize(entryMethod: ArkMethod): void {
        this.callGraphManager.initialize(entryMethod);
        this.cfgIndex.initialize(entryMethod);
    }

    getNormalSuccessors(stmt: Stmt): readonly Stmt[] {
        return this.cfgIndex.getNormalSuccessors(stmt);
    }

    getExceptionalSuccessors(stmt: Stmt): readonly Stmt[] {
        return this.cfgIndex.getExceptionalSuccessors(stmt);
    }

    getHandlerContinuation(handler: Stmt): Stmt {
        return this.cfgIndex.getHandlerContinuation(handler);
    }

    mayThrow(stmt: Stmt): boolean {
        return this.cfgIndex.mayThrow(stmt);
    }

    isCallStatement(stmt: Stmt): boolean {
        return this.callGraphManager.isCallStatement(stmt);
    }

    isExitStatement(stmt: Stmt): boolean {
        return this.cfgIndex.isExitStatement(stmt);
    }

    getAllCalleeMethods(call: Stmt): Set<ArkMethod> {
        return this.callGraphManager.getAllCalleeMethods(call);
    }

    getCalleesOfCallAt(call: Stmt): Set<ArkMethod> {
        return this.callGraphManager.getCalleesOfCallAt(call);
    }

    getReturnSiteOfCallAt(call: Stmt): Stmt | null {
        return this.cfgIndex.getReturnSiteOfCall(call);
    }

    getExceptionalReturnSitesOfCallAt(call: Stmt): readonly Stmt[] {
        return this.cfgIndex.getExceptionalReturnSitesOfCall(call);
    }

    getStartPointOf(method: ArkMethod): Stmt | null {
        return this.cfgIndex.getStartPointOf(method);
    }

    getStartPointOfCaller(call: Stmt): Stmt | null {
        return this.cfgIndex.getStartPointOfCaller(call);
    }
}
