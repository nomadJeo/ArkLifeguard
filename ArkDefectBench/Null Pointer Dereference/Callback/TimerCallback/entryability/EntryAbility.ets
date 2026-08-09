/*
Error message:Cannot read property refresh of null
Stacktrace:
    at anonymous entry (entry/src/main/ets/entryability/EntryAbility.ets:60:16)
*/
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  refresh(): void {
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let session: Session | null = null;
    setTimeout(() => {
      session!.refresh(); // NPD_EXPECTED: timer-callback
    }, 10);
  }
}
