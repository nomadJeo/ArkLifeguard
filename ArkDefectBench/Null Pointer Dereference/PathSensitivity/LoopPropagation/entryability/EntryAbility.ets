/*
Error message:Cannot read property refresh of null
Stacktrace:
    at onCreate entry (entry/src/main/ets/entryability/EntryAbility.ets:62:14)
*/
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  refresh(): void {
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let session: Session | null = new Session();
    for (let index = 0; index < 1; index++) {
      session = null;
    }
    session!.refresh(); // NPD_EXPECTED: loop-propagation
  }
}
