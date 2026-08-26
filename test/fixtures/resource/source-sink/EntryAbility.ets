import UIAbility from '@ohos.app.ability.UIAbility';

class AVPlayer {
    static createAVPlayer(): AVPlayer {
        return new AVPlayer();
    }

    release(): void {}
}

class TimerApi {
    static setInterval(): number { return 1; }
    static clearInterval(_id: number): void {}
}

class FileApi {
    static openSync(): number { return 1; }
    static closeSync(_fd: number): void {}
}

export default class EntryAbility extends UIAbility {
    onCreate(): void {
        const leakedPlayer = AVPlayer.createAVPlayer();
        leakedPlayer.toString();
    }

    onForeground(): void {
        const releasedPlayer = AVPlayer.createAVPlayer();
        releasedPlayer.release();
    }

    onBackground(): void {
        const fd = FileApi.openSync();
        FileApi.closeSync(fd);
    }

    onDestroy(): void {
        const timer = TimerApi.setInterval();
        TimerApi.clearInterval(timer);
    }
}
