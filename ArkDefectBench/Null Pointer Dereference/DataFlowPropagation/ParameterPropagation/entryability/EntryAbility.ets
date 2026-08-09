/*
Error message:Cannot read property refresh of null
Stacktrace:
    at consume entry (entry/src/main/ets/entryability/EntryAbility.ets:58:14)
    at forward entry (entry/src/main/ets/entryability/EntryAbility.ets:62:10)
    at onCreate entry (entry/src/main/ets/entryability/EntryAbility.ets:66:10)
*/
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  refresh(): void {
  }
}

export default class EntryAbility extends UIAbility {
  consume(session: Session | null): void {
    session!.refresh(); // NPD_EXPECTED: parameter-propagation
  }

  forward(session: Session | null): void {
    this.consume(session);
  }

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.forward(null);
  }
}
