import {
    AbstractInvokeExpr,
    ArkInvokeStmt,
    ArkMethod,
    CallGraph,
    CallGraphBuilder,
    ClassHierarchyAnalysis,
    Scene,
    Stmt,
} from '../../adapter/arkanalyzer';
import { getRecallMethodInParam } from '../CallResolver';

/** Owns call-graph construction and behavior-preserving callee queries. */
export class CallGraphManager {
    private analysis?: ClassHierarchyAnalysis;
    private entryMethod?: ArkMethod;

    constructor(private readonly scene: Scene) {}

    initialize(entryMethod: ArkMethod): void {
        this.entryMethod = entryMethod;
        const callGraph = new CallGraph(this.scene);
        this.analysis = new ClassHierarchyAnalysis(
            this.scene,
            callGraph,
            new CallGraphBuilder(callGraph, this.scene)
        );
    }

    getAllCalleeMethods(call: ArkInvokeStmt): Set<ArkMethod> {
        const analysis = this.requireAnalysis();
        const caller = call.getCfg()?.getDeclaringMethod() ?? this.entryMethod;
        if (!caller) return new Set();
        const callerNode = analysis.getCallGraph().getCallGraphNodeByMethod(caller.getSignature());
        if (!callerNode) return new Set();

        const methods = new Set<ArkMethod>();
        for (const callSite of analysis.resolveCall(callerNode.getID(), call)) {
            const signature = analysis.getCallGraph().getMethodByFuncID(callSite.calleeFuncID);
            const method = signature ? this.scene.getMethod(signature) : null;
            if (method) methods.add(method);
        }
        return methods;
    }

    getCalleesOfCallAt(call: ArkInvokeStmt): Set<ArkMethod> {
        const declaringFile = call.getInvokeExpr()
            .getMethodSignature().getDeclaringClassSignature().getDeclaringFileSignature();
        if (this.scene.getFile(declaringFile)) {
            return this.getAllCalleeMethods(call);
        }
        const recalled = getRecallMethodInParam(call);
        return recalled ? new Set([recalled]) : new Set();
    }

    isCallStatement(stmt: Stmt): boolean {
        for (const expr of stmt.getExprs()) {
            if (!(expr instanceof AbstractInvokeExpr)) continue;
            const declaringFile = expr.getMethodSignature()
                .getDeclaringClassSignature().getDeclaringFileSignature();
            if (this.scene.getFile(declaringFile)) return true;
            if (stmt instanceof ArkInvokeStmt && getRecallMethodInParam(stmt)) return true;
        }
        return false;
    }

    private requireAnalysis(): ClassHierarchyAnalysis {
        if (!this.analysis) {
            throw new Error('CallGraphManager must be initialized before querying callees');
        }
        return this.analysis;
    }
}
