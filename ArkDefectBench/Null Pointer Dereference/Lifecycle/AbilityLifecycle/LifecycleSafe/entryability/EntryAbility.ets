import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  close(): void {
  }
}

export default class EntryAbility extends UIAbility {
  session: Session | null = null;

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.session = new Session();
  }

  onDestroy(): void {
    this.session!.close(); // NPD_NOT_EXPECTED: lifecycle-safe
  }
}
