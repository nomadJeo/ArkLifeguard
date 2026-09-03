import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  refresh(): void {
  }
}

export default class EntryAbility extends UIAbility {
  private async failAsync(): Promise<void> {
    throw new Error('async failure');
  }

  private async run(): Promise<void> {
    let session: Session | null = null; // NPD_SOURCE
    try {
      await this.failAsync();
    } catch (error) {
      session!.refresh(); // NPD_EXPECTED: rejected await reaches catch
    }
  }

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.run();
  }
}
