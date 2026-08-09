import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Account {
  sync(): void {
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let account = this.findAccount(want.action);
    if (account !== null && account !== undefined) {
      account.sync(); // NPD_NOT_EXPECTED: safe-null-check
    }
  }

  findAccount(action: string | undefined): Account | null | undefined {
    if (action === 'sync') {
      return new Account();
    }
    if (action === 'missing') {
      return undefined;
    }
    return null;
  }
}
