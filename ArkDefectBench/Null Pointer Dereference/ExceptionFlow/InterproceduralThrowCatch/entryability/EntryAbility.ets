import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  refresh(): void {
  }
}

export default class EntryAbility extends UIAbility {
  private fail(): never {
    throw new Error('callee failure');
  }

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let session: Session | null = null; // NPD_SOURCE
    try {
      this.fail();
    } catch (error) {
      session!.refresh(); // NPD_EXPECTED: callee exceptional return
    }
  }
}
