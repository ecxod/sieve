/*
 * The content of this file is licensed. You may obtain a copy of
 * the license at https://github.com/thsmi/sieve/ or request it via
 * email from the author.
 *
 * Do not remove or change this comment.
 *
 * The initial author of the code is:
 *   Thomas Schmid <schmid-thomas@gmx.net>
 */

import { SieveScriptSaveDialog } from "./../dialogs/SieveDialogUI.mjs";

/**
 * Asks how an editor with changes should be closed.
 *
 * @param {string} name
 *   the script name.
 * @param {SieveEditorUI} editor
 *   the editor whose changes may need to be saved.
 * @param {SieveScriptSaveDialog} [dialog]
 *   an optional dialog instance, primarily used by tests.
 * @returns {boolean}
 *   true when the tab may close, otherwise false.
 */
async function confirmEditorClose(name, editor, dialog) {
  if (!dialog)
    dialog = new SieveScriptSaveDialog(name);

  const result = await dialog.show();

  if (SieveScriptSaveDialog.isDiscarded(result))
    return true;

  if (!SieveScriptSaveDialog.isAccepted(result))
    return false;

  return Boolean(await editor.save());
}

export { confirmEditorClose };
