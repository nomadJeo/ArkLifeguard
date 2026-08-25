class Account {
  refresh(): void {}
}

const missingAccount: Account | null = null;
missingAccount!.refresh(); // NPD_EXPECTED: module initializer executes on import

export const moduleInitialized = true;
