// pages/Index.ets

import { router } from '@kit.ArkUI';

class PageResource {
  resume(): void {
  }
}

@Entry
@Component
struct Index {
  resource: PageResource | null = new PageResource();

  onPageShow(): void {
    this.resource!.resume(); // NPD_EXPECTED: page-hide-show-reentry
  }

  onPageHide(): void {
    this.resource = null;
  }

  build() {
    Column() {
      Button('open detail')
        .onClick(() => {
          router.pushUrl({ url: 'pages/Detail' });
        });
    }
  }
}