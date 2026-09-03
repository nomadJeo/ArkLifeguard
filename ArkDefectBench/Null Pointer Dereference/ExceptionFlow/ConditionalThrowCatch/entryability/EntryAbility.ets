import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  refresh(): void {
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let session: Session | null = null; // NPD_SOURCE
    try {
      if (want !== undefined) {
        throw new Error('conditional failure');
      }
    } catch (error) {
      session!.refresh(); // NPD_EXPECTED: conditional exceptional edge
    }
  }
}
