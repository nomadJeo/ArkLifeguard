/*
Error message:Cannot read property stop of null
Stacktrace:
    at aboutToDisappear entry (entry/src/main/ets/pages/Index.ets:39:22)
*/
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
    this.controller!.stop(); // NPD_EXPECTED: component-state-reset
  }

  build() {
    Button('reset').onClick(() => {
      this.controller = null;
    });
  }
}
