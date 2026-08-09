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
    let cache: Map<string, UserProfile> = new Map<string, UserProfile>();
    let profile = cache.get('missing');
    let name = profile!.name; // NPD_EXPECTED: collection-propagation
  }
}
