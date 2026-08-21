@Component
struct EntryPage {
    aboutToAppear(): void {
        console.info('EntryPage aboutToAppear');
    }

    handleEntryTap(): void {
        console.info('EntryPage tap');
    }

    build() {
        Column() {
            Button('Entry')
                .onClick(this.handleEntryTap)
        }
    }
}
