class PageStateResource {
  use(): void {}
}

@Entry
@Component
struct Index {
  private repeatedShowResource: PageStateResource | null = new PageStateResource();
  private legalReentryResource: PageStateResource | null = new PageStateResource();

  onPageShow(): void {
    this.repeatedShowResource!.use(); // BENCH_SINK: repeated-page-show
    this.legalReentryResource!.use(); // BENCH_SINK: legal-page-reentry
    this.repeatedShowResource = null; // BENCH_SOURCE: repeated-page-show
  }

  onPageHide(): void {
    this.repeatedShowResource = new PageStateResource();
    this.legalReentryResource = null; // BENCH_SOURCE: legal-page-reentry
  }

  build(): void {}
}
