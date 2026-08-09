import { BackupExtensionAbility, BundleVersion } from '@kit.CoreFileKit';

class BackupSession {
  restore(): void {
  }
}

export default class EntryBackupAbility extends BackupExtensionAbility {
  private session: BackupSession | null = new BackupSession();

  async onBackup(): Promise<void> {
    this.session = null;
  }

  async onRestore(bundleVersion: BundleVersion): Promise<void> {
    this.session!.restore(); // NPD_EXPECTED: backup-restore-lifecycle
  }
}
