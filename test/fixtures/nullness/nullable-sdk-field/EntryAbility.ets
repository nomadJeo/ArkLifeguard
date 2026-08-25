import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

export default class EntryAbility extends UIAbility {
  onCreate(_want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    const unsafeStack = new Error().stack;
    unsafeStack!.split('\n'); // NPD_EXPECTED: Error.stack is optional

    const guardedStack = new Error().stack;
    if (guardedStack) {
      guardedStack.split('\n'); // NPD_NOT_EXPECTED: truthiness guard
    }
  }
}
