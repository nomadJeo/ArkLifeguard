import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Account {
  refresh(): void {
  }
}

class Provider {
  load(): Account | null {
    return new Account();
  }
}

class EmptyProvider extends Provider {
  load(): Account | null {
    return null;
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    const provider: Provider = new EmptyProvider();
    const account = provider.load();
    account!.refresh(); // NPD_EXPECTED: virtual-dispatch
  }
}
