import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  refresh(): void {
  }
}

export default class EntryAbility extends UIAbility {
  session: Session | null = new Session();

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.session = null;
    setTimeout(() => {
      this.session!.refresh(); // NPD_EXPECTED: delayed-execution
    }, 100);
  }
}
