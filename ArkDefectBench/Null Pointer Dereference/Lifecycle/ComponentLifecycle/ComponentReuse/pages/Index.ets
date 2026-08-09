class Controller {
  start(): void {
  }
}

@Reusable
@Component
struct ReusableCard {
  controller: Controller | null = new Controller();

  aboutToRecycle(): void {
    this.controller = null;
  }

  aboutToReuse(): void {
    this.controller!.start(); // NPD_EXPECTED: component-reuse
  }

  build() {
    Text('reusable card');
  }
}

@Entry
@Component
struct Index {
  build() {
    ReusableCard()
      .reuseId('controller-card');
  }
}
