/*
Stacktrace:
    at selectAccount entry (entry/src/main/ets/entryability/EntryAbility.ets:61:23)
    at onCreate entry (entry/src/main/ets/entryability/EntryAbility.ets:65:10)
*/
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Account {
  id: string = 'anonymous';
}

export default class EntryAbility extends UIAbility {
  selectAccount(clear: boolean): void {
    let account: Account | null = new Account();
    if (clear) {
      account = null;
    }
    let id = account!.id; // NPD_EXPECTED: branch-merge
  }

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.selectAccount(true);
  }
}
