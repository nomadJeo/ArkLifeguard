/*
Error message:Cannot read property refresh of null
Stacktrace:
    at onForeground entry (entry/src/main/ets/entryability/EntryAbility.ets:68:19)
*/
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  refresh(): void {
  }
}

export default class EntryAbility extends UIAbility {
  session: Session | null = null;

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.session = new Session();
  }

  onBackground(): void {
    this.session = null;
  }

  onForeground(): void {
    this.session!.refresh(); // NPD_EXPECTED: reentry-lifecycle
  }
}
