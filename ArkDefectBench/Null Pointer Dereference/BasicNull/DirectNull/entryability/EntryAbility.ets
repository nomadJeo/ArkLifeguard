/*
08-06 19:25:12.400   7980-18452    C03f00/ArkCompiler                                    E     [ArkRuntime Log] TypeError: Cannot read property name of null
08-06 19:25:12.400   7980-18452    C03f00/ArkCompiler                                    E     [ArkRuntime Log]     at onCreate (entry|entry|1.0.0|src/main/ets/entryability/EntryAbility.ts:10:29)
*/
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class UserProfile {
  name: string = 'guest';
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let profile: UserProfile | null = null;
    let name = profile!.name; // NPD_EXPECTED: direct-null-after-non-null-assertion
  }
}
