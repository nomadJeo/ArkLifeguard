export interface FactSemantics<D> {
    factEqual(left: D, right: D): boolean;
    factHash(fact: D): number;
}
