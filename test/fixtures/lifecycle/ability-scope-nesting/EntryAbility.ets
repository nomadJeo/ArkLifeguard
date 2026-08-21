import UIAbility from '@ohos.app.ability.UIAbility';
import window from '@ohos.window';

export default class EntryAbility extends UIAbility {
    onCreate(want: Want, launchParam: LaunchParam): void {
        console.info('EntryAbility onCreate');
    }

    onWindowStageCreate(windowStage: window.WindowStage): void {
        windowStage.loadContent('pages/EntryPage', (err) => {
            if (err) {
                console.error('Failed to load EntryPage');
            }
        });
    }
}
