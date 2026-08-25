export class Account {
  refresh(): void {
  }
}

const moduleAccount: Account = new Account();
let uninitializedModuleAccount: Account | undefined;

export function moduleStableAccount(): Account {
  return moduleAccount;
}

export function missingModuleAccount(): Account | undefined {
  return uninitializedModuleAccount;
}

export function selectFirst(values: Account[]): Account | null {
  if (values.length > 0) {
    return values[0];
  }
  return null;
}

export function stableAccount(): Account {
  return new Account();
}

export function assignedBeforeReturn(): Account {
  let account: Account;
  try {
    account = new Account();
  } catch (error) {
    throw error;
  }
  return account;
}

export function initializedAcrossLoop(values: Account[]): Account {
  let account = new Account();
  for (let index = 0; index < values.length; index++) {
    account = values[index];
  }
  return account;
}

export function requiredAccount(values: Account[]): Account | null;
export function requiredAccount(values: Account[], errorMessage: string): Account;
export function requiredAccount(values: Account[], errorMessage?: string): Account | null {
  if (values.length > 0) {
    return values[0];
  }
  if (errorMessage) {
    throw new Error(errorMessage);
  }
  return null;
}
