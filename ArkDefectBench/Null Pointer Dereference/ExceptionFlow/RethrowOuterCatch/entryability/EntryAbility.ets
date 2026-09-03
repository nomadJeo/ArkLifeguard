import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  refresh(): void {
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let session: Session | null = null; // NPD_SOURCE
    try {
      try {
        throw new Error('inner failure');
      } catch (error) {
        throw error;
      }
    } catch (error) {
      session!.refresh(); // NPD_EXPECTED: rethrow reaches outer catch
    }
  }
}
