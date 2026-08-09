/*
Error message:Cannot read property stop of null
Stacktrace:
    at onCreate entry (entry/src/main/ets/entryability/EntryAbility.ets:13:17)
*/
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Controller {
  stop(): void {
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let controller: Controller | null = null;
    controller = new Controller();
    controller = null;
    controller!.stop(); // NPD_EXPECTED: strong-update
  }
}
