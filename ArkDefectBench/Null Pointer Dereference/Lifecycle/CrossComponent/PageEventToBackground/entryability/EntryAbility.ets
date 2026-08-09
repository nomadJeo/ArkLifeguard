import { UIAbility } from '@kit.AbilityKit';

export class AbilitySession {
  suspend(): void {
  }
}

export default class EntryAbility extends UIAbility {
  static session: AbilitySession | null = new AbilitySession();

  onBackground(): void {
    EntryAbility.session!.suspend(); // NPD_EXPECTED: page-event-to-background
  }
}
