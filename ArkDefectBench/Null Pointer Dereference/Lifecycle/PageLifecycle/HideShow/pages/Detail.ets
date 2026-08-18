// pages/Detail.ets

import { router } from '@kit.ArkUI';

@Entry
@Component
struct Detail {
  build() {
    Column() {
      Button('back')
        .onClick(() => {
          router.back();
        });
    }
  }
}