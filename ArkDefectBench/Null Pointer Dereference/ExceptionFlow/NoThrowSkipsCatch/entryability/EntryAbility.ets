import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  refresh(): void {
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    const session: Session | null = null; // NPD_SOURCE
    try {
      const value = 1;
    } catch (error) {
      session!.refresh(); // NPD_NOT_EXPECTED: catch is unreachable without an exception
    }
  }
}
