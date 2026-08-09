class Controller {
  stop(): void {
  }
}

@Entry
@Component
struct Index {
  controller: Controller | null = null;

  aboutToAppear(): void {
    this.controller = new Controller();
  }

  aboutToDisappear(): void {
    this.controller!.stop(); // NPD_NOT_EXPECTED: appear-before-disappear
  }

  build() {
    Text('component lifecycle');
  }
}
