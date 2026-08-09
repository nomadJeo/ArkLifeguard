import EntryAbility from '../entryability/EntryAbility';

@Entry
@Component
struct Index {
  aboutToAppear(): void {
    EntryAbility.pageSession!.open(); // NPD_EXPECTED: ability-to-page
  }

  build() {
    Text('Ability to page lifecycle');
  }
}
