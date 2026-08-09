class Controller {
  run(): void {
  }
}

@Entry
@Component
struct Index {
  private controller: Controller | null = new Controller();

  clearController(): void {
    this.controller = null;
  }

  useController(): void {
    this.controller!.run(); // NPD_EXPECTED: ordered-ui-events
  }

  build() {
    Column() {
      Button('clear').onClick(() => this.clearController());
      Button('use').onClick(() => this.useController());
    }
  }
}
