import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { moduleInitialized } from './ModuleState';

export default class EntryAbility extends UIAbility {
  onCreate(_want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    if (moduleInitialized) {
      // Keep the import live; the defect is in ModuleState's module initializer.
    }
  }
}
