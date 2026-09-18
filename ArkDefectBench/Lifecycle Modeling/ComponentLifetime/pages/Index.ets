class ComponentResource {
  use(): void {}
}

@Entry
@Component
struct Index {
  private mountedResource: ComponentResource | null = new ComponentResource();
  private destroyedResource: ComponentResource | null = new ComponentResource();

  aboutToAppear(): void {
    this.mountedResource = null; // BENCH_SOURCE: mounted-component-event
  }

  aboutToDisappear(): void {
    this.destroyedResource = null; // BENCH_SOURCE: destroyed-component-event
  }

  handleClick(): void {
    this.mountedResource!.use(); // BENCH_SINK: mounted-component-event
    this.destroyedResource!.use(); // BENCH_SINK: destroyed-component-event
  }

  build(): void {
    Button('use').onClick(this.handleClick);
  }
}
