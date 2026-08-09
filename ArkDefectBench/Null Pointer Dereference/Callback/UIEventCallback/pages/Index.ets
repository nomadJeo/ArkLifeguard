/*
Error message:Cannot read property submit of null
Stacktrace:
    at anonymous entry (entry/src/main/ets/pages/Index.ets:36:24)
*/
class Controller {
  submit(): void {
  }
}

@Entry
@Component
struct Index {
  controller: Controller | null = null;

  build() {
    Button('submit').onClick(() => {
      this.controller!.submit(); // NPD_EXPECTED: ui-event-callback
    });
  }
}
