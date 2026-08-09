/*
Error message:Cannot read property name of undefined
Stacktrace:
    at onCreate entry (entry/src/main/ets/entryability/EntryAbility.ets:59:25)
*/
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class UserProfile {
  name: string = 'guest';
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let profile: UserProfile | undefined = undefined;
    let name = profile!.name; // NPD_EXPECTED: direct-undefined-after-non-null-assertion
  }
}
