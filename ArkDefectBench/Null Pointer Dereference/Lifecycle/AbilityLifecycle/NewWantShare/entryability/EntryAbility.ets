import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class SharePayload {
  serialize(): string {
    return 'payload';
  }
}

export default class EntryAbility extends UIAbility {
  private payload: SharePayload | null = new SharePayload();

  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.payload = null;
  }

  onShare(wantParam: Record<string, Object>): void {
    this.payload!.serialize(); // NPD_EXPECTED: new-want-share
  }
}
