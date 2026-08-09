import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Account {
  sync(): void {
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    Promise.resolve<Account | null>(null)
      .then((account: Account | null) => account)
      .then((account: Account | null) => {
        account!.sync(); // NPD_EXPECTED: promise-chain
      });
  }
}
