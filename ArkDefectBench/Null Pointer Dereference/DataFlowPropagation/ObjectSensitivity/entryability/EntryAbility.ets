import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Account {
  refresh(): void {
  }
}

class Holder {
  private account: Account | null;

  constructor(account: Account | null) {
    this.account = account;
  }

  use(): void {
    this.account!.refresh(); // NPD_NOT_EXPECTED: receiver-is-the-safe-holder
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    const emptyHolder = new Holder(null);
    const readyHolder = new Holder(new Account());
    readyHolder.use();
  }
}
