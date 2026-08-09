import { router } from '@kit.ArkUI';

class PageResource {
  save(): void {
  }
}

@Entry
@Component
struct Index {
  resource: PageResource | null = new PageResource();

  onPageHide(): void {
    this.resource!.save(); // NPD_EXPECTED: navigation-back
  }

  build() {
    Button('clear and navigate back')
      .onClick(() => {
        this.resource = null;
        router.back();
      });
  }
}
