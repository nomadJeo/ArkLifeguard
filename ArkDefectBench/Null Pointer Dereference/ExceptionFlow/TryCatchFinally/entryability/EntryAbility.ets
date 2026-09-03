import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  refresh(): void {
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let session: Session | null = null; // NPD_SOURCE
    try {
      throw new Error('try failure');
    } catch (error) {
      const handled = error;
    } finally {
      session!.refresh(); // NPD_EXPECTED: finally after caught exception
    }
  }
}
