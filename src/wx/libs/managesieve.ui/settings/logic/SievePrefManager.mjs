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

/* global browser */
import { SieveAbstractPrefManager } from "./SieveAbstractPrefManager.mjs";

/**
 * Manages preferences.
 * It uses the WebExtension's local storage interface
 */
class SieveMozPrefManager extends SieveAbstractPrefManager {

  /**
   * Clears all values in this namespace.
   */
  async clear() {
    const namespace = `${this.getNamespace()}.`;
    const values = await browser.storage.local.get(null);
    const keys = Object.keys(values)
      .filter((key) => { return key.startsWith(namespace); });

    if (keys.length)
      await browser.storage.local.remove(keys);
  }

  /**
   * @inheritdoc
   */
  async getValue(key) {
    key = `${this.getNamespace()}.${key}`;

    const pair = await browser.storage.local.get(key);

    if (pair[key] === undefined)
      return undefined;

    return pair[key];
  }

  /**
   * @inheritdoc
   */
  async setValue(key, value) {

    const item = {};
    item[`${this.getNamespace()}.${key}`] = value;

    await browser.storage.local.set(item);
    return this;
  }

  /**
   * Deletes a single value from this namespace.
   *
   * @param {string} key
   *   the unqualified preference key.
   * @returns {SievePrefManager}
   *   a self reference.
   */
  async removeKey(key) {
    await browser.storage.local.remove(`${this.getNamespace()}.${key}`);
    return this;
  }
}


export { SieveMozPrefManager as SievePrefManager };
