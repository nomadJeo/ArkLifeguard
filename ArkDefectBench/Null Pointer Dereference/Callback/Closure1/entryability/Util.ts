class Account {
  sync(): void {
  }
}

function loadAccount(): Account | null {
  return null;
}

export function outFunction(): void {
  function inFunction(): void {
    account!.sync(); // NPD_EXPECTED: single-level-closure
  }

  let account = loadAccount();
  inFunction();
}
