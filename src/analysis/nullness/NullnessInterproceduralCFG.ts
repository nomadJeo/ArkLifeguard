import {
    ArkAssignStmt,
    ArkInvokeStmt,
    ArkMethod,
    FunctionType,
    Scene,
    Stmt,
} from '../../adapter/arkanalyzer';
import { getRecallMethodInParam } from '../../ifds/CallResolver';
import { ArkInterproceduralCFG } from '../../ifds/icfg/ArkInterproceduralCFG';
import { resolveProjectMethods } from './ProjectMethodResolver';

/** Nullness-specific call resolution kept outside the generic IFDS solver. */
export class NullnessInterproceduralCFG extends ArkInterproceduralCFG {
    private readonly calleeCache = new Map<ArkInvokeStmt, Set<ArkMethod>>();

    constructor(private readonly scene: Scene) {
        super(scene);
    }

    override initialize(entryMethod: ArkMethod): void {
        this.calleeCache.clear();
        super.initialize(entryMethod);
    }

    override getCalleesOfCallAt(invokeStmt: ArkInvokeStmt): Set<ArkMethod> {
        const cached = this.calleeCache.get(invokeStmt);
        if (cached) return cached;

        const callees = resolveProjectMethods(this.scene, invokeStmt);
        const declaringFile = invokeStmt.getInvokeExpr()
            .getMethodSignature().getDeclaringClassSignature().getDeclaringFileSignature();
        if (this.scene.getFile(declaringFile)) {
            for (const callee of this.getAllCalleeMethods(invokeStmt)) callees.add(callee);
        } else {
            const recalled = getRecallMethodInParam(invokeStmt);
            if (recalled) callees.add(recalled);
        }
        this.calleeCache.set(invokeStmt, callees);
        return callees;
    }

    override isCallStatement(stmt: Stmt): boolean {
        if (super.isCallStatement(stmt)) return true;
        if (resolveProjectMethods(this.scene, stmt).size > 0) return true;
        if (!(stmt instanceof ArkAssignStmt)) return false;
        const invoke = stmt.getInvokeExpr();
        if (!invoke) return false;
        const methodName = invoke.getMethodSignature().getMethodSubSignature().getMethodName();
        return (methodName === 'then' || methodName === 'catch' || methodName === 'finally') &&
            invoke.getArgs().some(argument => argument.getType() instanceof FunctionType);
    }
}
