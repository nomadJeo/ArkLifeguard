/*
Error message:Cannot read property refresh of null
Stacktrace:
    at onCreate entry (entry/src/main/ets/entryability/EntryAbility.ets:63:16)
*/
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  refresh(): void {
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let session: Session | null = new Session();
    try {
      session = null;
      throw new Error('switch to exceptional path');
    } catch (error) {
      session!.refresh(); // NPD_EXPECTED: exception-path
    }
  }
}
