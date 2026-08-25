import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Account {
  refresh(): void {
  }
}

async function loadNullableAccount(): Promise<Account | null> {
  return null;
}

async function loadSafeAccount(): Promise<Account> {
  return new Account();
}

export default class EntryAbility extends UIAbility {
  async run(): Promise<void> {
    const nullableAccount = await loadNullableAccount();
    nullableAccount!.refresh(); // NPD_EXPECTED: nullable await result

    const safeAccount = await loadSafeAccount();
    safeAccount.refresh(); // NPD_NOT_EXPECTED: non-null await result
  }

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    const accounts: Array<Account | null> = [null, new Account()];
    accounts[0]!.refresh(); // NPD_EXPECTED: null element
    accounts[1]!.refresh(); // NPD_NOT_EXPECTED: distinct non-null element
    this.run();
  }
}
