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
      Button('open another page instance')
        .onClick(() => {
          router.pushUrl({ url: 'pages/Index' });
        });
      Button('return to previous page instance')
        .onClick(() => {
          router.back();
        });
    }
  }
}
