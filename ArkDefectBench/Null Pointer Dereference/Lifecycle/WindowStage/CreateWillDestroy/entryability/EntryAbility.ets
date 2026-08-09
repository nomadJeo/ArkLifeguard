import { UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';

class WindowResource {
  release(): void {
  }
}

export default class EntryAbility extends UIAbility {
  private resource: WindowResource | null = new WindowResource();

  onWindowStageCreate(windowStage: window.WindowStage): void {
    this.resource = null;
  }

  onWindowStageWillDestroy(windowStage: window.WindowStage): void {
    this.resource!.release(); // NPD_EXPECTED: window-stage-will-destroy
  }
}
