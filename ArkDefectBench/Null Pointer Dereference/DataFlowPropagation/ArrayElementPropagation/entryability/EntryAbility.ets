import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Account {
  refresh(): void {
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    const accounts: Array<Account | null> = [null];
    accounts[0]!.refresh(); // NPD_EXPECTED: array-element-propagation
  }
}
