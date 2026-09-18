import UIAbility from '@ohos.app.ability.UIAbility';

export default class UnusedAbility extends UIAbility {
    onForeground(): void {
        console.info('UnusedAbility foreground');
    }
}
