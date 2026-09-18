class PageResource {
  use(): void {}
}

@Entry
@Component
struct Index {
  private visibleResource: PageResource | null = new PageResource();
  private hiddenResource: PageResource | null = new PageResource();

  onPageShow(): void {
    this.hiddenResource = new PageResource();
    this.visibleResource = null; // BENCH_SOURCE: visible-page-event
  }

  onPageHide(): void {
    this.hiddenResource = null; // BENCH_SOURCE: hidden-page-event
  }

  handleClick(): void {
    this.visibleResource!.use(); // BENCH_SINK: visible-page-event
    this.hiddenResource!.use(); // BENCH_SINK: hidden-page-event
  }

  build(): void {
    Button('use').onClick(this.handleClick);
  }
}
