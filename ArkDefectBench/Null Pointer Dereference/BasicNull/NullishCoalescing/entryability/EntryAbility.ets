import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Account {
  id: string = 'anonymous';
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let account: Account | null = null;
    let safeAccount: Account = account ?? new Account();
    let id = safeAccount.id; // NPD_NOT_EXPECTED: non-null-fallback
  }
}
