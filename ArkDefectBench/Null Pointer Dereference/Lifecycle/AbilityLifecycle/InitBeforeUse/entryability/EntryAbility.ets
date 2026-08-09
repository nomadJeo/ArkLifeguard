import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  refresh(): void {
  }
}

export default class EntryAbility extends UIAbility {
  session: Session | null = null;

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.session = new Session();
  }

  onForeground(): void {
    this.session!.refresh(); // NPD_NOT_EXPECTED: initialized-before-use
  }
}
