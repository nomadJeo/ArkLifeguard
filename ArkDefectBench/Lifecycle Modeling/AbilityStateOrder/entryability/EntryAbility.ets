import UIAbility from '@ohos.app.ability.UIAbility';

class AbilityStateResource {
  use(): void {}
}

export default class EntryAbility extends UIAbility {
  private repeatedForegroundResource: AbilityStateResource | null = new AbilityStateResource();
  private legalReentryResource: AbilityStateResource | null = new AbilityStateResource();

  onCreate(): void {}

  onForeground(): void {
    this.repeatedForegroundResource!.use(); // BENCH_SINK: repeated-foreground
    this.legalReentryResource!.use(); // BENCH_SINK: legal-foreground-reentry
    this.repeatedForegroundResource = null; // BENCH_SOURCE: repeated-foreground
  }

  onBackground(): void {
    this.repeatedForegroundResource = new AbilityStateResource();
    this.legalReentryResource = null; // BENCH_SOURCE: legal-foreground-reentry
  }
}
