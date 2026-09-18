@Component
struct EntryPage {
    aboutToAppear(): void {
        console.info('EntryPage aboutToAppear');
    }

    handleEntryTap(): void {
        let want: Want = {
            bundleName: 'com.example.scope',
            abilityName: 'SecondAbility'
        };
        getContext(this).startAbility(want);
        console.info('EntryPage tap');
    }

    build() {
        Column() {
            Button('Entry')
                .onClick(this.handleEntryTap)
        }
    }
}
