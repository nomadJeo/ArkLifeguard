import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Account {
  balance: number = 0;
}

export default class EntryAbility extends UIAbility {
  account: Account | null = new Account();

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.clearAccount();
    this.readBalance();
  }

  clearAccount(): void {
    this.account = null;
  }

  readBalance(): void {
    let balance = this.account!.balance; // NPD_EXPECTED: field-propagation
  }
}
