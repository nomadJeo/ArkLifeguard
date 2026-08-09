/*
08-06 19:38:25.372   8140-14704    C03f00/ArkCompiler                                    E     [ArkRuntime Log] TypeError: Cannot read property id of undefined
08-06 19:38:25.372   8140-14704    C03f00/ArkCompiler                                    E     [ArkRuntime Log]     at onCreate (entry|entry|1.0.0|src/main/ets/entryability/EntryAbility.ts:12:28)
*/
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Account {
  id: string = 'anonymous';
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let cached: Account | null = null;
    let remote: Account | undefined = undefined;
    let selected: Account | null | undefined = cached ?? remote;
    let id = selected!.id; // NPD_EXPECTED: nullish-fallback-after-non-null-assertion
  }
}
