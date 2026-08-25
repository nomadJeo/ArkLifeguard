import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Session {
  private state: string | null = null;

  close(): void {
    this.state?.toString(); // NPD_NOT_EXPECTED: optional receiver does not enter String.toString with null this
  }
}

export default class EntryAbility extends UIAbility {
  private safe: Session | null = null;
  private unsafe: Session | null = null;
  private optional: Session | null = null;
  private guarded: Session | null = null;
  private guardedState: string = 'not-ready';

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.initializeSafe();
    this.optional?.close(); // NPD_NOT_EXPECTED: optional call has no normal callee edge when receiver is null
    if (this.isGuardedReadyState()) {
      this.guarded!.close(); // NPD_NOT_EXPECTED: ready-state predicate establishes class invariant
    }
    this.observeWithoutUpdating();
    this.unsafe!.close(); // NPD_EXPECTED: unchanged receiver field remains null
  }

  onDestroy(): void {
    this.safe!.close(); // NPD_NOT_EXPECTED: initialized by analyzed callee
  }

  private initializeSafe(): void {
    this.safe = new Session();
  }

  private observeWithoutUpdating(): void {
  }

  private markGuardedReady(): void {
    this.guarded = new Session();
    this.guardedState = 'ready';
  }

  private isGuardedReadyState(): boolean {
    return this.guardedState === 'ready';
  }
}
