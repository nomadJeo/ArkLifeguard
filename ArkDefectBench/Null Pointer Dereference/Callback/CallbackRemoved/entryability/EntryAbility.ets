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

  off(listener: () => void): void {
    if (this.listener === listener) {
      this.listener = null;
    }
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
    let listener = () => {
      account!.sync(); // NPD_NOT_EXPECTED: callback-removed
    };
    source.on(listener);
    source.off(listener);
    source.emit();
  }
}
