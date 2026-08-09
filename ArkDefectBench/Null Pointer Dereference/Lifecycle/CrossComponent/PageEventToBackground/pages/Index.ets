import EntryAbility from '../entryability/EntryAbility';

@Entry
@Component
struct Index {
  build() {
    Button('clear session').onClick(() => {
      EntryAbility.session = null;
    });
  }
}
