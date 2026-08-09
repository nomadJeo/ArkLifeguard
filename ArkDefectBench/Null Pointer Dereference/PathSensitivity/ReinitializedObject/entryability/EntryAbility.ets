import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Account {
  sync(): void {
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let account: Account | null = null;
    account = new Account();
    account.sync(); // NPD_NOT_EXPECTED: reinitialized-object
  }
}
