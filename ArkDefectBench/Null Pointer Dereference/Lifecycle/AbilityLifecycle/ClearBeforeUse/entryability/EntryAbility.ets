/*
Error message:Cannot read property close of null
Stacktrace:
    at onDestroy entry (entry/src/main/ets/entryability/EntryAbility.ets:71:19)
*/
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  close(): void {
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

  onDestroy(): void {
    this.session!.close(); // NPD_EXPECTED: clear-before-use
  }
}
