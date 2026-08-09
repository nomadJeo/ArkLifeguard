/*
Error message:Cannot read property sync of null
Stacktrace:
    at anonymous entry (entry/src/main/ets/entryability/EntryAbility.ets:75:16)
    at emit entry (entry/src/main/ets/entryability/EntryAbility.ets:65:12)
    at onCreate entry (entry/src/main/ets/entryability/EntryAbility.ets:77:12)
*/
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Account {
  sync(): void {
  }
}

class EventSource {
  listener: (() => void) | null = null;

  on(listener: () => void): void {
    this.listener = listener;
  }

  emit(): void {
    if (this.listener !== null) {
      this.listener();
    }
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let account: Account | null = null;
    let source = new EventSource();
    source.on(() => {
      account!.sync(); // NPD_EXPECTED: event-listener
    });
    source.emit();
  }
}
