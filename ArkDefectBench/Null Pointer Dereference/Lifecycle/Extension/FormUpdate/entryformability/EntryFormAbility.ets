import { Want } from '@kit.AbilityKit';
import formBindingData from '@ohos.app.form.formBindingData';
import FormExtensionAbility from '@ohos.app.form.FormExtensionAbility';

class FormController {
  refresh(): void {
  }
}

export default class EntryFormAbility extends FormExtensionAbility {
  private controller: FormController | null = new FormController();

  onAddForm(want: Want): formBindingData.FormBindingData {
    this.controller = null;
    return formBindingData.createFormBindingData({});
  }

  onUpdateForm(formId: string): void {
    this.controller!.refresh(); // NPD_EXPECTED: form-update-lifecycle
  }
}
