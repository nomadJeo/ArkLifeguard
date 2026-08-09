import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Account {
  refresh(): void {
  }
}

class BaseStore {
  protected account: Account | null = new Account();

  clear(): void {
    this.account = null;
  }
}

class DerivedStore extends BaseStore {
  use(): void {
    this.account!.refresh(); // NPD_EXPECTED: inherited-field
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    const store = new DerivedStore();
    store.clear();
    store.use();
  }
}
