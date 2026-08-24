/* global net */

const suite = net.tschmid.yautt.test;

if (!suite)
  throw new Error("Could not initialize test suite");

import { SieveScriptSaveDialog } from "./../../dialogs/SieveDialogUI.mjs";
import { confirmEditorClose } from "./../SieveEditorClose.mjs";
import { SieveTemplate } from "./../../utils/SieveTemplate.mjs";

/**
 * Exercises the real dialog button listener with a minimal DOM.
 *
 * @param {string} buttonClass
 *   the decision button class.
 * @returns {object}
 *   the dialog result.
 */
async function clickDialogButton(buttonClass) {
  const listeners = new Map();
  const scriptName = { textContent: "" };
  const button = {
    classList: {
      contains(value) { return value === buttonClass; }
    },
    addEventListener(type, listener) {
      if (type === "click")
        this.click = listener;
    }
  };
  const dialogElement = {
    id: "",
    addEventListener(type, listener) { listeners.set(type, listener); },
    querySelector() { return scriptName; },
    querySelectorAll() { return [button]; },
    remove() {}
  };

  globalThis.document = {
    querySelector(selector) {
      if (selector === "#ctx")
        return { append() {} };

      return dialogElement;
    }
  };

  globalThis.bootstrap = {
    /** Minimal Bootstrap modal used by this interaction test. */
    Modal: class {
      /** Emits the event Bootstrap sends after hiding a modal. */
      hide() {
        const listener = listeners.get("hidden.bs.modal");

        if (listener)
          listener();
      }

      /** The fake modal is visible immediately. */
      show() {}
    }
  };

  const originalLoad = SieveTemplate.prototype.load;
  SieveTemplate.prototype.load = async () => { return dialogElement; };

  try {
    const dialog = new SieveScriptSaveDialog("example");
    dialog.generateId = () => { return "test-dialog"; };

    const result = dialog.show();

    for (let attempt = 0; attempt < 10 && !button.click; attempt++)
      await Promise.resolve();

    if (!button.click)
      throw new Error("Dialog click listener was not registered");

    await button.click();
    return await result;
  } finally {
    SieveTemplate.prototype.load = originalLoad;
  }
}

suite.add("Save button returns the save decision", async function () {
  const result = await clickDialogButton("sieve-save-dialog-save");

  suite.assertTrue(SieveScriptSaveDialog.isAccepted(result));
});

suite.add("Discard button returns the discard decision", async function () {
  const result = await clickDialogButton("sieve-save-dialog-discard");

  suite.assertTrue(SieveScriptSaveDialog.isDiscarded(result));
});

suite.add("Saving changes closes only after a successful server save", async function () {
  let saves = 0;
  const editor = {
    async save() {
      saves++;
      return true;
    }
  };
  const accepted = new SieveScriptSaveDialog("example")
    .onAccept({ classList: { contains: (value) => { return value === "sieve-save-dialog-save"; } } });
  const dialog = { async show() { return accepted; } };

  suite.assertTrue(await confirmEditorClose("example", editor, dialog));
  suite.assertEquals(saves, 1);
});

suite.add("Failed server save keeps the editor open", async function () {
  const editor = { async save() { return false; } };
  const accepted = new SieveScriptSaveDialog("example")
    .onAccept({ classList: { contains: (value) => { return value === "sieve-save-dialog-save"; } } });
  const dialog = { async show() { return accepted; } };

  suite.assertFalse(await confirmEditorClose("example", editor, dialog));
});

suite.add("Discard closes without saving", async function () {
  let saves = 0;
  const editor = { async save() { saves++; return true; } };
  const discarded = new SieveScriptSaveDialog("example")
    .onAccept({ classList: { contains: (value) => { return value === "sieve-save-dialog-discard"; } } });
  const dialog = { async show() { return discarded; } };

  suite.assertTrue(await confirmEditorClose("example", editor, dialog));
  suite.assertEquals(saves, 0);
});

suite.add("Cancel keeps the editor open", async function () {
  const editor = { async save() { throw new Error("Save should not run"); } };
  const canceled = (new SieveScriptSaveDialog("example")).onCancel();
  const dialog = { async show() { return canceled; } };

  suite.assertFalse(await confirmEditorClose("example", editor, dialog));
});
