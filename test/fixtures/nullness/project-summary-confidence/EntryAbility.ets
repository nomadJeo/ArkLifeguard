import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import {
  Account,
  assignedBeforeReturn,
  initializedAcrossLoop,
  missingModuleAccount,
  moduleStableAccount,
  requiredAccount,
  selectFirst,
  stableAccount,
} from './Selectors';

export default class EntryAbility extends UIAbility {
  private current: Account | null = null;

  onCreate(_want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    const selected = selectFirst([]);
    selected!.refresh(); // NPD_EXPECTED: imported function has a null return path

    const stable = stableAccount();
    stable.refresh(); // NPD_NOT_EXPECTED: imported function is always non-null

    const moduleStable = moduleStableAccount();
    moduleStable.refresh(); // NPD_NOT_EXPECTED: module constant is initialized in %dflt

    const moduleMissing = missingModuleAccount();
    moduleMissing!.refresh(); // NPD_EXPECTED: module local has no initializer

    const assigned = assignedBeforeReturn();
    assigned.refresh(); // NPD_NOT_EXPECTED: all normal return paths assign the local

    const loopInitialized = initializedAcrossLoop([]);
    loopInitialized.refresh(); // NPD_NOT_EXPECTED: declaration identity differs across CFG blocks

    const required = requiredAccount([], 'missing account');
    required.refresh(); // NPD_NOT_EXPECTED: non-null overload throws when absent

    const alias = this.current;
    if (!alias) {
      return;
    }
    const reloaded = this.current;
    reloaded!.refresh(); // NPD_NOT_EXPECTED: dominating guard applies to field reload

    const unknownValue = mysteryLookup();
    unknownValue!.refresh(); // low-confidence unresolved evidence only
  }
}
