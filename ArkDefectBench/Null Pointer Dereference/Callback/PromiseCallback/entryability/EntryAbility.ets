import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Account {
  sync(): void {
  }
}

export default class EntryAbility extends UIAbility {
  account: Account | null = new Account();

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    Promise.resolve<Account | null>(null).then((account: Account | null) => {
      this.account = account;
      setTimeout(() => {
        this.useAccount();
      }, 0);
    });
  }

  useAccount(): void {
    this.account!.sync(); // NPD_EXPECTED: promise-callback-to-timer
  }
}
