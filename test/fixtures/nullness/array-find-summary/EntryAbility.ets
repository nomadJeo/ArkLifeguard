import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Account {
  refresh(): void {}
}

export default class EntryAbility extends UIAbility {
  onCreate(_want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    const accounts = [new Account()];
    accounts.find((_account: Account): boolean => false)!.refresh(); // NPD_EXPECTED

    const guarded = accounts.find((_account: Account): boolean => false);
    if (guarded) {
      guarded.refresh(); // NPD_NOT_EXPECTED
    }
  }
}
