import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  close(): void {
  }
}

class BaseAbility extends UIAbility {
  protected session: Session | null = new Session();

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.session = null;
  }
}

export default class EntryAbility extends BaseAbility {
  onDestroy(): void {
    this.session!.close(); // NPD_EXPECTED: inherited-lifecycle
  }
}
