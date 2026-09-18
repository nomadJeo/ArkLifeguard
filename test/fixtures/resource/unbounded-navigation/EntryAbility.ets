import UIAbility from '@ohos.app.ability.UIAbility';

class AVPlayer {
    static createAVPlayer(): AVPlayer {
        return new AVPlayer();
    }

    release(): void {}
}

class Router {
    pushUrl(): void {}
}

export default class EntryAbility extends UIAbility {
    onCreate(): void {
        const player = AVPlayer.createAVPlayer();
        new Router().pushUrl();
        new Router().pushUrl();
        player.release();
    }
}
