import { UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';

export class PageSession {
  open(): void {
  }
}

export default class EntryAbility extends UIAbility {
  static pageSession: PageSession | null = new PageSession();

  onWindowStageCreate(windowStage: window.WindowStage): void {
    EntryAbility.pageSession = null;
    windowStage.loadContent('pages/Index');
  }
}
