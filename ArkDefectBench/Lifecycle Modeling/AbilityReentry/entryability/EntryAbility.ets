import UIAbility from '@ohos.app.ability.UIAbility';

class AbilityResource {
  use(): void {}
}

export default class EntryAbility extends UIAbility {
  private reentryResource: AbilityResource | null = new AbilityResource();
  private destroyedResource: AbilityResource | null = new AbilityResource();

  onCreate(): void {}

  onBackground(): void {
    this.reentryResource = null; // BENCH_SOURCE: legal-foreground-reentry
  }

  onForeground(): void {
    this.reentryResource!.use(); // BENCH_SINK: legal-foreground-reentry
    this.destroyedResource!.use(); // BENCH_SINK: destroyed-ability-foreground
  }

  onDestroy(): void {
    this.destroyedResource = null; // BENCH_SOURCE: destroyed-ability-foreground
  }
}
