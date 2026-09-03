import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  refresh(): void {
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    const session: Session | null = null; // NPD_SOURCE
    try {
      session!.refresh(); // NPD_EXPECTED: dereference throws before catch
    } catch (error) {
      const handled = error;
    }
  }
}
