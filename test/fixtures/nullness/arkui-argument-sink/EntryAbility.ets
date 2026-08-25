import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

declare function ForEach<T>(
  values: T[],
  builder: (value: T) => void
): void;

function nullableItems(): string[] | null {
  return null;
}

export default class EntryAbility extends UIAbility {
  onCreate(_want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    const missingItems: string[] | null = null;
    ForEach(missingItems!, (_item: string): void => {}); // NPD_EXPECTED

    const presentItems: string[] = [];
    ForEach(presentItems, (_item: string): void => {}); // NPD_NOT_EXPECTED

    const guardedItems = nullableItems();
    if (guardedItems) {
      ForEach(guardedItems, (_item: string): void => {}); // NPD_NOT_EXPECTED
    }

    const conjunctGuardedItems = nullableItems();
    if (conjunctGuardedItems && conjunctGuardedItems.length > 0) {
      ForEach(conjunctGuardedItems, (_item: string): void => {}); // NPD_NOT_EXPECTED
    }
  }
}

@Component
struct RequiredItemsView {
  @Require items?: string[] = undefined;

  build() {
    ForEach(this.items, (_item: string): void => {}); // NPD_NOT_EXPECTED
  }
}
