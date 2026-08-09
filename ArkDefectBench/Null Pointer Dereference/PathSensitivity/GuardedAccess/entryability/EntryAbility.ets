import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Account {
  id: string = 'anonymous';
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let account = this.loadAccount(want.action);
    if (account !== null) {
      let id: string = account.id; // NPD_NOT_EXPECTED: guarded-access
    }
  }

  loadAccount(action: string | undefined): Account | null {
    if (action === undefined) {
      return null;
    }
    return new Account();
  }
}
