import UIAbility from '@ohos.app.ability.UIAbility';

export default class TestAbility extends UIAbility {
    onForeground(): void {
        console.info('TestAbility foreground');
    }
}
