/*
Error message:Cannot read property refresh of undefined
Stacktrace:
    at refreshCurrent entry (entry/src/main/ets/entryability/EntryAbility.ets:64:19)
    at onCreate entry (entry/src/main/ets/entryability/EntryAbility.ets:71:11)

*/
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  refresh(): void {
  }
}

class SessionStore {
  current?: Session;

  constructor() {
    this.current = undefined;
  }

  refreshCurrent(): void {
    this.current!.refresh(); // NPD_EXPECTED: optional-property-after-non-null-assertion
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let store = new SessionStore();
    store.refreshCurrent();
  }
}
