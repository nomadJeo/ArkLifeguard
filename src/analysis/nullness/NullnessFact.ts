/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/** A minimal local-variable contract that keeps the fact model independent of ArkAnalyzer classes. */
export interface INullnessLocal {
    getName(): string;
    getType(): unknown;
}

/** A minimal field-signature contract used by access paths. */
export interface INullnessFieldSignature {
    getFieldName(): string;
    toString(): string;
}

/** Synthetic field-like segment used to keep array elements in the access-path domain. */
class NullnessArrayIndexSegment implements INullnessFieldSignature {
    constructor(private readonly index: string | null) {}

    getFieldName(): string {
        return `[${this.index ?? '*'}]`;
    }

    toString(): string {
        return `array-index:${this.index ?? '*'}`;
    }

    isWildcard(): boolean {
        return this.index === null;
    }
}

/** Synthetic field-like segment for values carried by a Promise object. */
class NullnessPromisePayloadSegment implements INullnessFieldSignature {
    getFieldName(): string {
        return '[[PromiseValue]]';
    }

    toString(): string {
        return 'promise-payload';
    }
}

/**
 * Conservative suffix used when an access path exceeds the configured depth.
 *
 * Keep the first omitted field as an anchor. A plain wildcard made
 * `this.kdbx.credentials.passwordHash` indistinguishable from
 * `this.kdbx.header`, because both collapsed to `this.kdbx.*`. The anchor
 * still summarizes every descendant below `credentials`, but cannot match a
 * sibling field such as `header`.
 */
class NullnessWildcardSegment implements INullnessFieldSignature {
    constructor(readonly anchor: INullnessFieldSignature | null) {}

    getFieldName(): string {
        return this.anchor ? `*{${this.anchor.getFieldName()}}` : '*';
    }

    toString(): string {
        return this.anchor
            ? `wildcard-suffix:${this.anchor.toString()}`
            : 'wildcard-suffix';
    }

    matches(segment: INullnessFieldSignature): boolean {
        if (!this.anchor) return true;
        const candidate = segment instanceof NullnessWildcardSegment
            ? segment.anchor
            : segment;
        return candidate !== null && this.anchor.toString() === candidate.toString();
    }
}

const PROMISE_PAYLOAD_SEGMENT = new NullnessPromisePayloadSegment();
const WILDCARD_SEGMENT = new NullnessWildcardSegment(null);

/** A minimal statement contract used only for provenance and source locations. */
export interface INullnessStmt {
    getOriginPositionInfo(): { getLineNo(): number; getColNo(): number } | undefined;
}

/** The kinds of null-like values represented by the IFDS fact domain. */
export enum NullnessKind {
    Null = 'null',
    Undefined = 'undefined',
    MaybeNull = 'maybe-null',
    MaybeUndefined = 'maybe-undefined',
    MaybeNullish = 'maybe-nullish',
}

/** Whether the abstract value represented by a kind may contain null. */
export function mayBeNull(kind: NullnessKind): boolean {
    return kind === NullnessKind.Null ||
        kind === NullnessKind.MaybeNull ||
        kind === NullnessKind.MaybeNullish;
}

/** Whether the abstract value represented by a kind may contain undefined. */
export function mayBeUndefined(kind: NullnessKind): boolean {
    return kind === NullnessKind.Undefined ||
        kind === NullnessKind.MaybeUndefined ||
        kind === NullnessKind.MaybeNullish;
}

/** Remove the null alternative. null means no tracked nullish alternative remains. */
export function removeNull(kind: NullnessKind): NullnessKind | null {
    switch (kind) {
        case NullnessKind.Null:
        case NullnessKind.MaybeNull:
            return null;
        case NullnessKind.MaybeNullish:
            return NullnessKind.MaybeUndefined;
        default:
            return kind;
    }
}

/** Remove the undefined alternative. null means no tracked nullish alternative remains. */
export function removeUndefined(kind: NullnessKind): NullnessKind | null {
    switch (kind) {
        case NullnessKind.Undefined:
        case NullnessKind.MaybeUndefined:
            return null;
        case NullnessKind.MaybeNullish:
            return NullnessKind.MaybeNull;
        default:
            return kind;
    }
}

/** Remove both null and undefined alternatives. */
export function removeNullish(kind: NullnessKind): NullnessKind | null {
    const withoutNull = removeNull(kind);
    return withoutNull === null ? null : removeUndefined(withoutNull);
}

/** Keep only the null alternative on an equality branch. */
export function keepOnlyNull(kind: NullnessKind): NullnessKind | null {
    return mayBeNull(kind) ? NullnessKind.Null : null;
}

/** Keep only the undefined alternative on an equality branch. */
export function keepOnlyUndefined(kind: NullnessKind): NullnessKind | null {
    return mayBeUndefined(kind) ? NullnessKind.Undefined : null;
}

/** Why a nullness fact was introduced. */
export enum NullnessOriginKind {
    NullLiteral = 'null-literal',
    UndefinedLiteral = 'undefined-literal',
    Uninitialized = 'uninitialized',
    NullableReturn = 'nullable-return',
    LibraryModel = 'library-model',
    /** A call whose declaration/return contract could not be resolved. */
    UnresolvedReturn = 'unresolved-return',
    Unknown = 'unknown',
}

export interface NullnessOrigin {
    kind: NullnessOriginKind;
    stmt: INullnessStmt;
    description?: string;
}

type SpecialAccessPath = 'normal' | 'empty' | 'zero';

/**
 * Identifies the program value described by a nullness fact.
 *
 * Examples:
 * - `value` -> base=value, fields=[]
 * - `this.session` -> base=this, fields=[session]
 * - `holder.user.name` -> base=holder, fields=[user, name]
 */
export class NullnessAccessPath {
    readonly base: INullnessLocal | null;
    readonly baseType: unknown;
    readonly fields: readonly INullnessFieldSignature[];
    readonly isStatic: boolean;

    private readonly special: SpecialAccessPath;
    private cachedHashCode = 0;

    private static emptyAccessPath: NullnessAccessPath | null = null;
    private static zeroAccessPath: NullnessAccessPath | null = null;

    constructor(
        base: INullnessLocal | null,
        baseType: unknown = null,
        fields: readonly INullnessFieldSignature[] = [],
        isStatic: boolean = false,
        special: SpecialAccessPath = 'normal'
    ) {
        this.base = base;
        this.baseType = baseType ?? base?.getType() ?? null;
        this.fields = Object.freeze([...fields]);
        this.isStatic = isStatic;
        this.special = special;
    }

    static fromValue(value: unknown): NullnessAccessPath {
        if (!value || typeof value !== 'object') {
            return NullnessAccessPath.getEmptyAccessPath();
        }

        const candidate = value as {
            getName?: () => string;
            getType?: () => unknown;
            getBase?: () => INullnessLocal;
            getIndex?: () => unknown;
            getFieldSignature?: () => INullnessFieldSignature;
            getFieldName?: () => string;
            toString?: () => string;
        };

        if (typeof candidate.getBase === 'function' &&
            typeof candidate.getIndex === 'function') {
            const base = candidate.getBase();
            const index = candidate.getIndex() as { getValue?: () => string } | undefined;
            const constantIndex = typeof index?.getValue === 'function'
                ? index.getValue()
                : null;
            return new NullnessAccessPath(
                base,
                base.getType(),
                [new NullnessArrayIndexSegment(constantIndex)]
            );
        }

        if (typeof candidate.getFieldSignature === 'function') {
            const field = candidate.getFieldSignature();
            if (typeof candidate.getBase === 'function') {
                const base = candidate.getBase();
                return new NullnessAccessPath(base, base.getType(), [field]);
            }
            return new NullnessAccessPath(null, candidate.getType?.() ?? null, [field], true);
        }

        // ArkAnalyzer models captured variables as ClosureFieldRef rather than a
        // regular ArkInstanceFieldRef.  ClosureFieldRef is itself the stable
        // field descriptor (base + captured name), but it has no FieldSignature.
        if (typeof candidate.getFieldName === 'function' &&
            typeof candidate.getBase === 'function' &&
            typeof candidate.toString === 'function') {
            const base = candidate.getBase();
            return new NullnessAccessPath(
                base,
                base.getType(),
                [candidate as INullnessFieldSignature]
            );
        }

        if (typeof candidate.getName === 'function' && typeof candidate.getType === 'function') {
            return new NullnessAccessPath(candidate as INullnessLocal, candidate.getType());
        }

        return NullnessAccessPath.getEmptyAccessPath();
    }

    static getEmptyAccessPath(): NullnessAccessPath {
        if (!NullnessAccessPath.emptyAccessPath) {
            NullnessAccessPath.emptyAccessPath = new NullnessAccessPath(null, null, [], false, 'empty');
        }
        return NullnessAccessPath.emptyAccessPath;
    }

    static getZeroAccessPath(): NullnessAccessPath {
        if (!NullnessAccessPath.zeroAccessPath) {
            NullnessAccessPath.zeroAccessPath = new NullnessAccessPath(null, null, [], false, 'zero');
        }
        return NullnessAccessPath.zeroAccessPath;
    }

    isEmpty(): boolean {
        return this.special === 'empty';
    }

    isZero(): boolean {
        return this.special === 'zero';
    }

    isLocal(): boolean {
        return this.special === 'normal' && this.base !== null && this.fields.length === 0;
    }

    isInstanceFieldRef(): boolean {
        return this.special === 'normal' && this.base !== null && this.fields.length > 0 && !this.isStatic;
    }

    isStaticFieldRef(): boolean {
        return this.special === 'normal' && this.isStatic && this.fields.length > 0;
    }

    appendField(field: INullnessFieldSignature): NullnessAccessPath {
        this.assertNormal('append a field to');
        if (this.hasWildcardSuffix()) {
            return this;
        }
        return new NullnessAccessPath(this.base, this.baseType, [...this.fields, field], this.isStatic);
    }

    appendPromisePayload(): NullnessAccessPath {
        return this.appendField(PROMISE_PAYLOAD_SEGMENT);
    }

    dropLastField(): NullnessAccessPath {
        this.assertNormal('drop a field from');
        if (this.fields.length === 0) {
            return this;
        }
        return new NullnessAccessPath(this.base, this.baseType, this.fields.slice(0, -1), this.isStatic);
    }

    replaceBase(newBase: INullnessLocal): NullnessAccessPath {
        this.assertNormal('replace the base of');
        return new NullnessAccessPath(newBase, newBase.getType(), this.fields, false);
    }

    /**
     * Bound the field domain without dropping the fact. The last retained segment
     * denotes every possible suffix below the first omitted field, so sibling
     * object fields remain distinct while the number of stored segments stays
     * bounded.
     */
    truncateWithWildcard(maxLength: number): NullnessAccessPath {
        if (this.special !== 'normal' || this.fields.length <= maxLength) {
            return this;
        }
        const prefixLength = Math.max(0, maxLength - 1);
        const firstOmitted = this.fields[prefixLength];
        const wildcard = firstOmitted instanceof NullnessWildcardSegment
            ? firstOmitted
            : new NullnessWildcardSegment(firstOmitted);
        return new NullnessAccessPath(
            this.base,
            this.baseType,
            [...this.fields.slice(0, prefixLength), wildcard],
            this.isStatic
        );
    }

    /**
     * Return the semantic suffix after a known prefix. Consuming an anchored
     * wildcard still leaves an unknown descendant; returning an empty suffix
     * here would incorrectly turn `object.child.*` into nullable `object.child`.
     */
    remainingFieldsAfter(prefix: NullnessAccessPath): readonly INullnessFieldSignature[] {
        const remaining = this.fields.slice(prefix.fields.length);
        if (remaining.length > 0 || prefix.fields.length === 0 ||
            prefix.fields.length !== this.fields.length) {
            return remaining;
        }
        const summarized = this.fields[this.fields.length - 1];
        const consumed = prefix.fields[prefix.fields.length - 1];
        return summarized instanceof NullnessWildcardSegment &&
            !(consumed instanceof NullnessWildcardSegment) &&
            summarized.matches(consumed)
            ? [WILDCARD_SEGMENT]
            : remaining;
    }

    hasWildcardSuffix(): boolean {
        return this.fields.some(field => field instanceof NullnessWildcardSegment);
    }

    equals(other: NullnessAccessPath | null): boolean {
        if (!other) {
            return false;
        }
        if (this === other) {
            return true;
        }
        if (this.special !== other.special || this.base !== other.base || this.isStatic !== other.isStatic) {
            return false;
        }
        if (this.fields.length !== other.fields.length) {
            return false;
        }
        return this.fields.every((field, index) => field.toString() === other.fields[index].toString());
    }

    isPrefixOf(other: NullnessAccessPath): boolean {
        if (this.special !== 'normal' || other.special !== 'normal') {
            return false;
        }
        if (this.base !== other.base || this.isStatic !== other.isStatic || this.fields.length > other.fields.length) {
            return false;
        }
        for (let index = 0; index < this.fields.length; index++) {
            const field = this.fields[index];
            if (field instanceof NullnessWildcardSegment) {
                return field.matches(other.fields[index]);
            }
            if (!this.segmentsCompatible(field, other.fields[index])) {
                return false;
            }
        }
        return true;
    }

    hashCode(): number {
        if (this.cachedHashCode !== 0) {
            return this.cachedHashCode;
        }
        const key = `${this.special}|${this.isStatic}|${this.base?.getName() ?? '<static>'}|${this.fields.map(f => f.toString()).join('.')}`;
        let hash = 17;
        for (let index = 0; index < key.length; index++) {
            hash = (hash * 31 + key.charCodeAt(index)) | 0;
        }
        this.cachedHashCode = hash === 0 ? 1 : hash;
        return this.cachedHashCode;
    }

    toString(): string {
        if (this.isZero()) {
            return '<zero>';
        }
        if (this.isEmpty()) {
            return '<empty>';
        }
        const baseName = this.base?.getName() ?? '<static>';
        const fieldSuffix = this.fields.reduce((suffix, field) => {
            const name = field.getFieldName();
            return `${suffix}${name.startsWith('[') ? '' : '.'}${name}`;
        }, '');
        return `${baseName}${fieldSuffix}`;
    }

    private segmentsCompatible(
        left: INullnessFieldSignature,
        right: INullnessFieldSignature
    ): boolean {
        if (left.toString() === right.toString()) {
            return true;
        }
        if (left instanceof NullnessWildcardSegment) {
            return left.matches(right);
        }
        if (right instanceof NullnessWildcardSegment) {
            return right.matches(left);
        }
        return left instanceof NullnessArrayIndexSegment &&
            right instanceof NullnessArrayIndexSegment &&
            (left.isWildcard() || right.isWildcard());
    }

    private assertNormal(operation: string): void {
        if (this.special !== 'normal') {
            throw new Error(`Cannot ${operation} the ${this.special} access path`);
        }
    }
}

/**
 * An IFDS fact meaning that an access path may evaluate to a null-like value.
 *
 * Provenance is intentionally excluded from equality. Otherwise the same data-flow fact
 * arriving through different paths would grow the IFDS domain without changing semantics.
 */
export class NullnessFact {
    readonly accessPath: NullnessAccessPath;
    readonly kind: NullnessKind;
    readonly origin: NullnessOrigin | null;
    readonly currentStmt: INullnessStmt | null;
    readonly predecessor: NullnessFact | null;
    readonly propagationDepth: number;
    /** True once a bounded access-path abstraction has contributed to this fact. */
    readonly approximated: boolean;

    private readonly zeroFact: boolean;
    private static zeroInstance: NullnessFact | null = null;

    private constructor(
        accessPath: NullnessAccessPath,
        kind: NullnessKind,
        origin: NullnessOrigin | null,
        currentStmt: INullnessStmt | null,
        predecessor: NullnessFact | null,
        propagationDepth: number,
        zeroFact: boolean,
        approximated: boolean
    ) {
        this.accessPath = accessPath;
        this.kind = kind;
        this.origin = origin;
        this.currentStmt = currentStmt;
        this.predecessor = predecessor;
        this.propagationDepth = propagationDepth;
        this.zeroFact = zeroFact;
        this.approximated = approximated;
    }

    static getZeroFact(): NullnessFact {
        if (!NullnessFact.zeroInstance) {
            NullnessFact.zeroInstance = new NullnessFact(
                NullnessAccessPath.getZeroAccessPath(),
                NullnessKind.MaybeNull,
                null,
                null,
                null,
                0,
                true,
                false
            );
        }
        return NullnessFact.zeroInstance;
    }

    static create(accessPath: NullnessAccessPath, kind: NullnessKind, origin: NullnessOrigin): NullnessFact {
        if (accessPath.isZero() || accessPath.isEmpty()) {
            throw new Error('A nullness fact requires a non-empty, non-zero access path');
        }
        return new NullnessFact(accessPath, kind, origin, origin.stmt, null, 0, false, false);
    }

    isZeroFact(): boolean {
        return this.zeroFact;
    }

    deriveWithNewStmt(stmt: INullnessStmt): NullnessFact {
        this.assertNonZero();
        return new NullnessFact(
            this.accessPath,
            this.kind,
            this.origin,
            stmt,
            this,
            this.propagationDepth + 1,
            false,
            this.approximated
        );
    }

    deriveWithNewAccessPath(accessPath: NullnessAccessPath, stmt: INullnessStmt): NullnessFact {
        this.assertNonZero();
        if (accessPath.isZero() || accessPath.isEmpty()) {
            throw new Error('A derived nullness fact requires a non-empty, non-zero access path');
        }
        return new NullnessFact(
            accessPath,
            this.kind,
            this.origin,
            stmt,
            this,
            this.propagationDepth + 1,
            false,
            this.approximated || accessPath.hasWildcardSuffix()
        );
    }

    deriveWithReplacedBase(base: INullnessLocal, stmt: INullnessStmt): NullnessFact {
        return this.deriveWithNewAccessPath(this.accessPath.replaceBase(base), stmt);
    }

    deriveWithKind(kind: NullnessKind, stmt: INullnessStmt): NullnessFact {
        this.assertNonZero();
        return new NullnessFact(
            this.accessPath,
            kind,
            this.origin,
            stmt,
            this,
            this.propagationDepth + 1,
            false,
            this.approximated
        );
    }

    abstractAccessPath(maxLength: number): NullnessFact {
        if (this.zeroFact) {
            return this;
        }
        const abstractPath = this.accessPath.truncateWithWildcard(maxLength);
        if (abstractPath === this.accessPath) {
            return this;
        }
        return new NullnessFact(
            abstractPath,
            this.kind,
            this.origin,
            this.currentStmt,
            this.predecessor,
            this.propagationDepth,
            false,
            true
        );
    }

    /**
     * Collapse definite and possible values within their original nullish
     * category. Null and undefined are joined only when both are observed by
     * ordinary IFDS propagation, rather than being invented at every entry.
     */
    widenKindForRecursion(): NullnessFact {
        if (this.zeroFact || this.kind === NullnessKind.MaybeNull ||
            this.kind === NullnessKind.MaybeUndefined ||
            this.kind === NullnessKind.MaybeNullish) {
            return this;
        }
        const widenedKind = this.kind === NullnessKind.Null
            ? NullnessKind.MaybeNull
            : NullnessKind.MaybeUndefined;
        return new NullnessFact(
            this.accessPath,
            widenedKind,
            this.origin,
            this.currentStmt,
            this.predecessor,
            this.propagationDepth,
            false,
            this.approximated
        );
    }

    equals(other: NullnessFact | null): boolean {
        if (!other) {
            return false;
        }
        if (this === other) {
            return true;
        }
        if (this.zeroFact || other.zeroFact) {
            return this.zeroFact && other.zeroFact;
        }
        return this.kind === other.kind &&
            this.isUnresolvedEvidence() === other.isUnresolvedEvidence() &&
            this.accessPath.equals(other.accessPath);
    }

    hashCode(): number {
        if (this.zeroFact) {
            return 1;
        }
        const evidenceClass = this.isUnresolvedEvidence() ? 1 : 0;
        return ((this.accessPath.hashCode() * 31 + this.kind.length) * 31 + evidenceClass) | 0;
    }

    getPropagationPath(): INullnessStmt[] {
        if (this.zeroFact) {
            return [];
        }
        const path: INullnessStmt[] = [];
        const visited = new Set<NullnessFact>();
        let cursor: NullnessFact | null = this;
        while (cursor && !cursor.zeroFact && !visited.has(cursor)) {
            visited.add(cursor);
            if (cursor.currentStmt) {
                path.push(cursor.currentStmt);
            }
            cursor = cursor.predecessor;
        }
        return path.reverse().filter((stmt, index, all) => index === 0 || stmt !== all[index - 1]);
    }

    toString(): string {
        const evidence = this.isUnresolvedEvidence() ? '?' : '';
        return this.zeroFact ? 'ZERO' : `${evidence}${this.kind}(${this.accessPath.toString()})`;
    }

    isUnresolvedEvidence(): boolean {
        return this.origin?.kind === NullnessOriginKind.UnresolvedReturn;
    }

    isApproximateEvidence(): boolean {
        return this.approximated;
    }

    private assertNonZero(): void {
        if (this.zeroFact) {
            throw new Error('The IFDS zero fact cannot be derived as a program nullness fact');
        }
    }
}
