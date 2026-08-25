import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';

class Account {
  refresh(): void {
  }
}

function nullableAccount(): Account | null {
  return null;
}

class GetterHolder {
  private selected: Account | null = new Account();

  get currentNode(): Account | null {
    return this.selected;
  }

  refreshCurrent(): void {
    if (this.currentNode) {
      this.currentNode!.refresh(); // NPD_NOT_EXPECTED: repeated getter is stable in this block
    }
  }
}

abstract class BaseController {
  protected config?: Account = undefined;

  refresh(): void {
    this.config!.refresh(); // NPD_NOT_EXPECTED: every concrete constructor initializes config
  }
}

class ConcreteController extends BaseController {
  constructor() {
    super();
    this.config = new Account();
  }
}

export default class EntryAbility extends UIAbility {
  private observers: Account[] | null = null;

  onCreate(_want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    const guarded = nullableAccount();
    if (guarded) {
      guarded.refresh(); // NPD_NOT_EXPECTED: truthy branch excludes null
    }

    const negatedGuard = nullableAccount();
    if (!negatedGuard) {
      return;
    }
    negatedGuard.refresh(); // NPD_NOT_EXPECTED: false edge of !value excludes null

    if (this.observers) {
      this.observers.push(new Account()); // NPD_NOT_EXPECTED: guarded nullable field
    }

    const text = ' abc ';
    const normalized = text.substring(0, text.length).trim();
    normalized.startsWith('a'); // NPD_NOT_EXPECTED: string methods return strings

    const match = /a/.exec(text);
    if (match && match.length > 0) {
      match.slice(); // NPD_NOT_EXPECTED: && right side and body are guarded
    }

    const instanceGuard = nullableAccount();
    if (!(instanceGuard instanceof Account) || instanceGuard.toString().length === 0) {
      // NPD_NOT_EXPECTED: the right side runs only after instanceof succeeds
    }

    let captured: Account | undefined = undefined;
    const initializeCaptured = (): void => {
      captured = new Account();
      captured.refresh(); // NPD_NOT_EXPECTED: closure-local strong update
    };
    initializeCaptured();

    const unsafeMatch = /z/.exec(text);
    unsafeMatch!.slice(); // NPD_EXPECTED: nullable RegExp.exec result

    let firstMatch: RegExpMatchArray | null = null;
    let lastMatch: RegExpMatchArray | null;
    if (
      text === 'first' ||
      (firstMatch = /first/.exec(text)) ||
      (lastMatch = /last/.exec(text))
    ) {
      const selectedMatch = text === 'first' ? [] :
        firstMatch ? firstMatch : lastMatch![0];
      selectedMatch.toString(); // NPD_NOT_EXPECTED: final assignment is truthy on this ternary arm
    }

    new GetterHolder().refreshCurrent();
    new ConcreteController().refresh();

    const templateValue = nullableAccount();
    const rendered = `templateValue: ${templateValue}`; // NPD_NOT_EXPECTED: interpolation stringifies null
    rendered.toString();
  }
}
