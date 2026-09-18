import { ArkInterproceduralCFG } from '../../ifds/icfg/ArkInterproceduralCFG';

/**
 * Nullness uses the shared enhanced call resolver, including imported functions
 * and callbacks in assignment calls. Do not union raw CHA targets here: doing so
 * would reintroduce callbacks that the project callee never invokes.
 */
export class NullnessInterproceduralCFG extends ArkInterproceduralCFG {}
