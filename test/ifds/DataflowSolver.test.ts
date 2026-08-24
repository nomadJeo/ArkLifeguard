import path from 'node:path';
import { describe, expect, it } from 'vitest';
import 'arkanalyzer';
import {
    ArkMethod,
    Scene,
    SceneConfig,
    Stmt,
} from '../../src/adapter/arkanalyzer';
import {
    DataflowProblem,
    DataflowSolver,
    FlowFunction,
    PathEdge,
    PathEdgePoint,
} from '../../src/ifds';

class IdentityFlowFunction implements FlowFunction<string> {
    getDataFacts(fact: string): Set<string> {
        return new Set([fact]);
    }
}

class IdentityProblem extends DataflowProblem<string> {
    private readonly identity = new IdentityFlowFunction();

    constructor(
        private readonly entryPoint: Stmt,
        private readonly entryMethod: ArkMethod
    ) {
        super();
    }

    getNormalFlowFunction(_srcStmt: Stmt, _tgtStmt: Stmt): FlowFunction<string> {
        return this.identity;
    }

    getCallFlowFunction(_srcStmt: Stmt, _method: ArkMethod): FlowFunction<string> {
        return this.identity;
    }

    getExitToReturnFlowFunction(
        _srcStmt: Stmt,
        _tgtStmt: Stmt,
        _callStmt: Stmt
    ): FlowFunction<string> {
        return this.identity;
    }

    getCallToReturnFlowFunction(
        _srcStmt: Stmt,
        _tgtStmt: Stmt,
        _callees?: ReadonlySet<ArkMethod>
    ): FlowFunction<string> {
        return this.identity;
    }

    createZeroValue(): string {
        return 'ZERO';
    }

    getEntryPoint(): Stmt {
        return this.entryPoint;
    }

    getEntryMethod(): ArkMethod {
        return this.entryMethod;
    }

    factEqual(left: string, right: string): boolean {
        return left === right;
    }
}

class IdentitySolver extends DataflowSolver<string> {}

function buildScene(): Scene {
    const projectPath = path.resolve(
        __dirname,
        '../fixtures/ifds/normal-flow'
    );
    const config = new SceneConfig();
    config.buildConfig('ifds-normal-flow', projectPath, []);
    config.buildFromProjectDir(projectPath);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

describe('IFDS migration smoke tests', () => {
    it('keeps path edge endpoints and facts', () => {
        const node = {} as Stmt;
        const start = new PathEdgePoint(node, 'ZERO');
        const end = new PathEdgePoint(node, 'FACT');
        const edge = new PathEdge(start, end);

        expect(edge.edgeStart).toBe(start);
        expect(edge.edgeEnd).toBe(end);
        expect(edge.edgeEnd.fact).toBe('FACT');
    });

    it('propagates an identity fact over an ordinary CFG', () => {
        const scene = buildScene();
        const method = scene.getMethods().find(candidate => candidate.getName() === 'run');
        expect(method).toBeDefined();
        const cfg = method!.getCfg();
        expect(cfg).toBeDefined();

        const problem = new IdentityProblem(cfg!.getStartingStmt(), method!);
        const solver = new IdentitySolver(problem, scene);
        solver.solve();

        const reachedStatements = new Set(
            [...solver.getPathEdgeSet()].map(edge => edge.edgeEnd.node)
        );
        for (const stmt of cfg!.getStmts()) {
            expect(reachedStatements.has(stmt), stmt.toString()).toBe(true);
        }
    });
});
