/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

import { ClassSignature, MethodSignature } from '../../adapter/arkanalyzer';

type NamespaceSignature = NonNullable<
    ReturnType<ClassSignature['getDeclaringNamespaceSignature']>
>;

/**
 * Compare callable identities without rendering their parameter types.
 *
 * ArkAnalyzer may represent recursive generic types (for example a class whose
 * generic argument is an array referring back to that class). Rendering a full
 * MethodSignature traverses those types and is therefore unsafe as an identity
 * operation across ArkAnalyzer versions.
 */
export function haveSameCallableIdentity(
    left: MethodSignature,
    right: MethodSignature
): boolean {
    if (left === right) {
        return true;
    }

    const leftSubSignature = left.getMethodSubSignature();
    const rightSubSignature = right.getMethodSubSignature();
    if (leftSubSignature === rightSubSignature) {
        return sameDeclaringClass(
            left.getDeclaringClassSignature(),
            right.getDeclaringClassSignature()
        );
    }
    if (leftSubSignature.getMethodName() !== rightSubSignature.getMethodName() ||
        leftSubSignature.isStatic() !== rightSubSignature.isStatic() ||
        leftSubSignature.getParameters().length !== rightSubSignature.getParameters().length) {
        return false;
    }

    return sameDeclaringClass(
        left.getDeclaringClassSignature(),
        right.getDeclaringClassSignature()
    );
}

/** Return null when a framework type cannot be rendered safely. */
export function tryRenderArkType(type: { toString(): string }): string | null {
    try {
        return type.toString();
    } catch (error) {
        if (error instanceof RangeError) {
            return null;
        }
        throw error;
    }
}

function sameDeclaringClass(left: ClassSignature, right: ClassSignature): boolean {
    if (left === right) {
        return true;
    }
    if (left.getClassName() !== right.getClassName()) {
        return false;
    }

    const leftFile = left.getDeclaringFileSignature();
    const rightFile = right.getDeclaringFileSignature();
    if (leftFile !== rightFile &&
        (leftFile.getProjectName() !== rightFile.getProjectName() ||
            leftFile.getFileName() !== rightFile.getFileName())) {
        return false;
    }

    return sameNamespace(
        left.getDeclaringNamespaceSignature(),
        right.getDeclaringNamespaceSignature()
    );
}

function sameNamespace(
    left: NamespaceSignature | null,
    right: NamespaceSignature | null
): boolean {
    const visited = new Map<NamespaceSignature, Set<NamespaceSignature>>();
    while (left && right) {
        if (left === right) {
            return true;
        }
        const matchingRight = visited.get(left);
        if (matchingRight?.has(right)) {
            return true;
        }
        if (matchingRight) {
            matchingRight.add(right);
        } else {
            visited.set(left, new Set([right]));
        }
        if (left.getNamespaceName() !== right.getNamespaceName()) {
            return false;
        }
        left = left.getDeclaringNamespaceSignature();
        right = right.getDeclaringNamespaceSignature();
    }
    return left === right;
}
