import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  refresh(): void {
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    const session: Session | null = null; // NPD_SOURCE
    try {
      try {
        throw new Error('original failure');
      } finally {
        throw session;
      }
    } catch (error) {
      const caught = error as Session | null;
      caught!.refresh(); // NPD_EXPECTED: finally throw overrides original throw
    }
  }
}
