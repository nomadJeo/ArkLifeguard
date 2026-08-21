/*
 * 测试资源：边界情况 - 最小化 Ability
 * 只有必要的生命周期方法
 */

import UIAbility from '@ohos.app.ability.UIAbility';

export default class MinimalAbility extends UIAbility {
    // 只有 onCreate，没有其他生命周期方法
    onCreate(): void {
        console.log('MinimalAbility onCreate');
    }
}
