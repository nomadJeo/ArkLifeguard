import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Account {
  sync(): void {
  }
}

async function loadAccount(): Promise<Account | null> {
  return null;
}

export default class EntryAbility extends UIAbility {
  async run(): Promise<void> {
    let account = await loadAccount();
    account!.sync(); // NPD_EXPECTED: async-await
  }

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.run();
  }
}
