@Component
struct SecondPage {
    aboutToAppear(): void {
        console.info('SecondPage aboutToAppear');
    }

    handleSecondTap(): void {
        console.info('SecondPage tap');
    }

    build() {
        Column() {
            Button('Second')
                .onClick(this.handleSecondTap)
        }
    }
}
