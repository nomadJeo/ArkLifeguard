import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Account {
  active: boolean = true;
}

export default class EntryAbility extends UIAbility {
  private unsafeAccount?: Account;
  private safeAccount?: Account;

  onCreate(_want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    if (!this.unsafeAccount!.active || this.unsafeAccount === undefined) {
      return; // NPD_EXPECTED: the right operand is evaluated too late
    }

    if (this.safeAccount === undefined || !this.safeAccount.active) {
      return; // NPD_NOT_EXPECTED: short-circuit guard is evaluated first
    }
  }
}
