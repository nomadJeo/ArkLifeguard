import {
    addCfg2Stmt,
    ArkAwaitExpr,
    ArkCaughtExceptionRef,
    ArkInstanceFieldRef,
    ArkMethod,
    ArkReturnStmt,
    ArkReturnVoidStmt,
    ArkThrowStmt,
    BasicBlock,
    Scene,
    Stmt,
} from '../../adapter/arkanalyzer';

interface StmtSuccessors {
    normal: Set<Stmt>;
    exceptional: Set<Stmt>;
}

/** Builds and queries a statement-level view of ArkAnalyzer CFGs. */
export class CfgIndex {
    private readonly stmtSuccessors = new Map<Stmt, StmtSuccessors>();

    constructor(private readonly scene: Scene) {}

    initialize(entryMethod: ArkMethod): void {
        this.stmtSuccessors.clear();
        this.attachCfgToStatements();

        // Scene.getMethods() may expose the Scene's backing array. Mutating it
        // would make later solvers observe repeated synthetic entries.
        const methods = new Set([...this.scene.getMethods(), entryMethod]);
        for (const method of methods) {
            const blocks = Array.from(method.getCfg()?.getBlocks() ?? []);
            for (const block of blocks) {
                this.indexBlock(block);
            }
            this.repairFinallyAndCopiedHandlerEdges(method, blocks);
        }
    }

    getNormalSuccessors(stmt: Stmt): readonly Stmt[] {
        return Array.from(this.stmtSuccessors.get(stmt)?.normal ?? []);
    }

    getExceptionalSuccessors(stmt: Stmt): readonly Stmt[] {
        return Array.from(this.stmtSuccessors.get(stmt)?.exceptional ?? []);
    }

    getHandlerContinuation(handler: Stmt): Stmt {
        if (handler.getUses().some(value => value instanceof ArkCaughtExceptionRef)) {
            return this.getNormalSuccessors(handler)[0] ?? handler;
        }
        return handler;
    }

    mayThrow(stmt: Stmt): boolean {
        return (
            stmt instanceof ArkThrowStmt ||
            stmt.getInvokeExpr() !== undefined ||
            stmt.getExprs().some(expr => expr instanceof ArkAwaitExpr) ||
            stmt.containsArrayRef() ||
            stmt.getFieldRef() instanceof ArkInstanceFieldRef
        );
    }

    isExitStatement(stmt: Stmt): boolean {
        if (stmt instanceof ArkThrowStmt) {
            return this.getExceptionalSuccessors(stmt).length === 0;
        }
        if (stmt instanceof ArkReturnStmt || stmt instanceof ArkReturnVoidStmt) {
            return this.getNormalSuccessors(stmt).length === 0;
        }
        return false;
    }

    getReturnSiteOfCall(call: Stmt): Stmt | null {
        return this.getNormalSuccessors(call)[0] ?? null;
    }

    getExceptionalReturnSitesOfCall(call: Stmt): readonly Stmt[] {
        return this.getExceptionalSuccessors(call);
    }

    getStartPointOf(method: ArkMethod): Stmt | null {
        return method.getCfg()?.getStartingBlock()?.getStmts()[method.getParameters().length] ?? null;
    }

    getStartPointOfCaller(call: Stmt): Stmt | null {
        const method = call.getCfg()?.getDeclaringMethod();
        return method ? this.getStartPointOf(method) : null;
    }

    private attachCfgToStatements(): void {
        for (const cls of this.scene.getClasses()) {
            for (const method of cls.getMethods(true)) {
                addCfg2Stmt(method);
            }
        }
    }

    private indexBlock(block: BasicBlock): void {
        const stmts = block.getStmts();
        const normalBlockSuccessors = this.collectSuccessorHeads(block.getSuccessors());
        const exceptionalBlockSuccessors = this.collectSuccessorHeads(
            block.getExceptionalSuccessorBlocks() ?? []
        );

        for (let stmtIndex = 0; stmtIndex < stmts.length; stmtIndex++) {
            const stmt = stmts[stmtIndex];
            if (!stmt) continue;

            const normal = new Set<Stmt>();
            const exceptional = new Set<Stmt>();
            if (stmt instanceof ArkThrowStmt) {
                for (const successor of exceptionalBlockSuccessors) exceptional.add(successor);
            } else if (stmtIndex !== stmts.length - 1) {
                const nextStmt = stmts[stmtIndex + 1];
                if (nextStmt) normal.add(nextStmt);
            } else {
                for (const successor of normalBlockSuccessors) normal.add(successor);
            }
            if (this.mayThrow(stmt)) {
                for (const successor of exceptionalBlockSuccessors) exceptional.add(successor);
            }
            this.stmtSuccessors.set(stmt, { normal, exceptional });
        }
    }

    private collectSuccessorHeads(blocks: readonly BasicBlock[]): Set<Stmt> {
        const result = new Set<Stmt>();
        for (const block of blocks) {
            for (const head of this.getFirstStatements(block)) result.add(head);
        }
        return result;
    }

    private getFirstStatements(block: BasicBlock, visited = new Set<BasicBlock>()): Set<Stmt> {
        if (visited.has(block)) return new Set();
        visited.add(block);
        const head = block.getHead();
        if (head) return new Set([head]);
        const result = new Set<Stmt>();
        for (const successor of block.getSuccessors()) {
            for (const stmt of this.getFirstStatements(successor, visited)) result.add(stmt);
        }
        return result;
    }

    /** Recover ArkAnalyzer 1.0.90 gaps around lowered finally blocks. */
    private repairFinallyAndCopiedHandlerEdges(method: ArkMethod, blocks: BasicBlock[]): void {
        const traps = method.getBody()?.getTraps() ?? [];
        if (traps.length === 0) return;

        const blocksByStmt = new Map<Stmt, BasicBlock>();
        const sourceCopies = new Map<string, Stmt[]>();
        for (const block of blocks) {
            for (const stmt of block.getStmts()) {
                blocksByStmt.set(stmt, block);
                const key = this.getSourceStatementKey(stmt);
                if (!key) continue;
                const copies = sourceCopies.get(key) ?? [];
                copies.push(stmt);
                sourceCopies.set(key, copies);
            }
        }

        // A copied exceptional-finally statement inherits handlers available on
        // its source-backed counterpart.
        for (const copies of sourceCopies.values()) {
            const inherited = new Set<Stmt>();
            const sourceBacked = copies.filter(stmt => stmt.getOriginalText() !== undefined);
            const syntheticCopies = copies.filter(stmt => stmt.getOriginalText() === undefined);
            if (sourceBacked.length === 0 || syntheticCopies.length === 0) continue;
            for (const stmt of sourceBacked) {
                for (const target of this.getExceptionalSuccessors(stmt)) inherited.add(target);
            }
            if (inherited.size === 0) continue;
            for (const stmt of syntheticCopies) {
                if (!this.mayThrow(stmt)) continue;
                const successors = this.stmtSuccessors.get(stmt);
                if (!successors) continue;
                for (const target of inherited) successors.exceptional.add(target);
            }
        }

        for (const trap of traps) {
            const exceptionalFinally = trap.getCatchBlocks().find(block => {
                const stmts = block.getStmts();
                return (
                    stmts[0]?.getDef() !== null &&
                    stmts[0]?.getUses().some(value => value instanceof ArkCaughtExceptionRef) &&
                    stmts.at(-1) instanceof ArkThrowStmt &&
                    stmts.at(-1)?.getOriginalText() === undefined
                );
            });
            if (!exceptionalFinally) continue;

            const finallySourceStmt = exceptionalFinally
                .getStmts()
                .slice(1, -1)
                .find(stmt => this.getSourceStatementKey(stmt) !== null);
            const sourceKey = finallySourceStmt ? this.getSourceStatementKey(finallySourceStmt) : null;
            if (!sourceKey) continue;
            const normalFinallyStmt = (sourceCopies.get(sourceKey) ?? []).find(
                stmt => blocksByStmt.get(stmt) !== exceptionalFinally && stmt.getOriginalText() !== undefined
            );
            if (!normalFinallyStmt) continue;

            for (const tryBlock of trap.getTryBlocks()) {
                const tail = tryBlock.getTail();
                if (!(tail instanceof ArkReturnStmt) && !(tail instanceof ArkReturnVoidStmt)) continue;
                const successors = this.stmtSuccessors.get(tail);
                if (!successors) continue;
                successors.normal.clear();
                successors.normal.add(normalFinallyStmt);
            }
        }
    }

    private getSourceStatementKey(stmt: Stmt): string | null {
        if (stmt.getUses().some(value => value instanceof ArkCaughtExceptionRef)) return null;
        return `${stmt.constructor.name}:${stmt.toString()}`;
    }
}
