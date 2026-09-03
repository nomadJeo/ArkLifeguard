import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  refresh(): void {
  }
}

export default class EntryAbility extends UIAbility {
  private async failAsync(): Promise<void> {
    throw new Error('promise rejection');
  }

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let session: Session | null = null; // NPD_SOURCE
    this.failAsync().finally(() => {
      session!.refresh(); // NPD_EXPECTED: finally callback after rejection
    });
  }
}
