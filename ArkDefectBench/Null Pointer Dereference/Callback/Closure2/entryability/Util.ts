class Account {
  sync(): void {
  }
}

function loadAccount(): Account | null {
  return null;
}

export function outFunction(): void {
  function inFunction1(): void {
    function inFunction2(): void {
      account!.sync(); // NPD_EXPECTED: multi-level-closure
    }

    inFunction2();
  }

  let account = loadAccount();
  inFunction1();
}
