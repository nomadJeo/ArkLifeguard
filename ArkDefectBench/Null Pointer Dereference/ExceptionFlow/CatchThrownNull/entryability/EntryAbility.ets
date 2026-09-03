import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  refresh(): void {
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    const session: Session | null = null; // NPD_SOURCE
    try {
      throw session;
    } catch (error) {
      const caught = error as Session | null;
      caught!.refresh(); // NPD_EXPECTED: thrown value mapped to catch parameter
    }
  }
}
