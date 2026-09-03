import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  refresh(): void {
  }
}

export default class EntryAbility extends UIAbility {
  private finish(): void {
    let session: Session | null = null; // NPD_SOURCE
    try {
      return;
    } finally {
      session!.refresh(); // NPD_EXPECTED: return executes finally first
    }
  }

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.finish();
  }
}
