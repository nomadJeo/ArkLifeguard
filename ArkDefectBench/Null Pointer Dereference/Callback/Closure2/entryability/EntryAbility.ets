/* Expected runtime error: Cannot read property sync of null. */
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { outFunction } from './Util';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    outFunction();
  }
}
