/*
Error message:Cannot read property name of undefined
Stacktrace:
    at onCreate entry (entry/src/main/ets/entryability/EntryAbility.ets:62:25)
*/
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class UserProfile {
  name: string = 'guest';
}

function findProfile(): UserProfile | undefined {
  return undefined;
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let profile = findProfile();
    let name = profile!.name; // NPD_EXPECTED: return-propagation
  }
}
