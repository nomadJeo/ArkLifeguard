import UIAbility from '@ohos.app.ability.UIAbility';
import window from '@ohos.window';

export default class SecondAbility extends UIAbility {
    onCreate(want: Want, launchParam: LaunchParam): void {
        console.info('SecondAbility onCreate');
    }

    onWindowStageCreate(windowStage: window.WindowStage): void {
        windowStage.loadContent('pages/SecondPage', (err) => {
            if (err) {
                console.error('Failed to load SecondPage');
            }
        });
    }
}
