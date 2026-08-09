import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  start(): void {
  }
}

export default class EntryAbility extends UIAbility {
  private session: Session | null = new Session();

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.session!.start(); // NPD_NOT_EXPECTED: destroy-cannot-flow-back-to-create
  }

  onDestroy(): void {
    this.session = null;
  }
}
