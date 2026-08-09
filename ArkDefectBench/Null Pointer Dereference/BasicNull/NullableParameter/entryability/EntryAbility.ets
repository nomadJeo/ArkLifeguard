/*
08-06 19:23:54.348   14644-10228   C03f00/ArkCompiler                                    E     [ArkRuntime Log] TypeError: Cannot read property id of null
08-06 19:23:54.348   14644-10228   C03f00/ArkCompiler                                    E     [ArkRuntime Log]     at useAccount (entry|entry|1.0.0|src/main/ets/entryability/EntryAbility.ts:9:27)
08-06 19:23:54.348   14644-10228   C03f00/ArkCompiler                                    E     [ArkRuntime Log]     at onCreate (entry|entry|1.0.0|src/main/ets/entryability/EntryAbility.ts:12:14)
*/
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Account {
  id: string = 'anonymous';
}

export default class EntryAbility extends UIAbility {
  useAccount(account: Account | null): void {
    let id = account!.id; // NPD_EXPECTED: nullable-parameter-after-non-null-assertion
  }

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.useAccount(null);
  }
}

