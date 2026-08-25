class Account {
  refresh(): void {}
}

class UserRepository {
  get(_key: string): Account {
    return new Account();
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(_want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    const missingAccounts = new Map<string, Account>();
    missingAccounts.get('missing')!.refresh();

    const knownAccounts = new Map<string, Account>();
    knownAccounts.set('known', new Account());
    knownAccounts.get('known')!.refresh();

    const guardedAccounts = new Map<string, Account>();
    if (guardedAccounts.has('known')) {
      guardedAccounts.get('known')!.refresh();
    }

    const repository = new UserRepository();
    repository.get('known').refresh();
  }
}
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
