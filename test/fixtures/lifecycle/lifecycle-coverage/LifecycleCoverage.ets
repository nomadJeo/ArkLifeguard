class UIAbility {
}

class BackupExtensionAbility {
}

class FullUIAbility extends UIAbility {
  onCreate(): void {}
  onWindowStageCreate(): void {}
  onWindowStageWillDestroy(): void {}
  onWindowStageDestroy(): void {}
  onWindowStageRestore(): void {}
  onForeground(): void {}
  onBackground(): void {}
  onContinue(): void {}
  onNewWant(): void {}
  onDump(): void {}
  onSaveState(): void {}
  onShare(): void {}
  onPrepareToTerminate(): void {}
  onPrepareToTerminateAsync(): void {}
  onBackPressed(): void {}
  onDestroy(): void {}
}

class FullBackupAbility extends BackupExtensionAbility {
  onBackup(): void {}
  onBackupEx(): void {}
  onRestore(): void {}
  onRestoreEx(): void {}
  onProcess(): void {}
}

@Entry
@Component
struct FullComponent {
  aboutToAppear(): void {}
  onWillApplyTheme(): void {}
  build(): void {}
  onDidBuild(): void {}
  onPageShow(): void {}
  onBackPress(): void {}
  onKeyEvent(): void {}
  aboutToRecycle(): void {}
  aboutToReuse(): void {}
  onPageHide(): void {}
  aboutToDisappear(): void {}
}
