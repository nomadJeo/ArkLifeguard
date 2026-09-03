import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  refresh(): void {
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    const session: Session | null = null; // NPD_SOURCE
    throw new Error('uncaught failure');
    session!.refresh(); // NPD_NOT_EXPECTED: unreachable after uncaught throw
  }
}
