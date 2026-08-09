import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Person {
  nick: string | null = null;
  spouse?: Person;
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let person = this.loadPerson();
    let nick: string | null | undefined = person?.spouse?.spouse?.nick; // NPD_NOT_EXPECTED: long-optional-chain-short-circuit
  }

  loadPerson(): Person | null {
    return null;
  }
}
