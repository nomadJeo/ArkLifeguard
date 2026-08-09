import { UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';

class WindowResource {
  release(): void {
  }
}

export default class EntryAbility extends UIAbility {
  private resource: WindowResource | null = null;

  onWindowStageCreate(windowStage: window.WindowStage): void {
    this.resource = new WindowResource();
  }

  onWindowStageWillDestroy(windowStage: window.WindowStage): void {
    this.resource!.release(); // NPD_NOT_EXPECTED: initialized-before-window-destroy
  }
}
