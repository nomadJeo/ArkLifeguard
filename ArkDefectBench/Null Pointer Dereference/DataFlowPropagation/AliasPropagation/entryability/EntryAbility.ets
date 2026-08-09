/*
Error message:Cannot read property text of null
Stacktrace:
    at onCreate entry (entry/src/main/ets/entryability/EntryAbility.ets:59:23)
*/
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Message {
  text: string = 'hello';
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let original: Message | null = null;
    let alias: Message | null = original;
    let text = alias!.text; // NPD_EXPECTED: alias-propagation
  }
}
