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

import { SieveCustomHost } from "./SieveAbstractHost.mjs";

const CONFIG_KEEP_ALIVE_INTERVAL = "keepalive";
const CONFIG_KEY_IS_CUSTOM = "custom";
const CONFIG_KEY_HOSTNAME = "hostname";
const CONFIG_KEY_DISPLAY_NAME = "host.displayName";
// eslint-disable-next-line no-magic-numbers
const ONE_MINUTE = 60 * 1000;
// eslint-disable-next-line no-magic-numbers
const FIVE_MINUTES = 5 * ONE_MINUTE;

/**
 * This class loads the hostname from an IMAP account. The hostname is not
 * cached it. This ensures that always the most recent settings are used.
 */
class SieveMozHost extends SieveCustomHost {

  /**
   * Checks if this server was entered directly in the extension.
   *
   * @returns {boolean}
   *   true for a custom server.
   */
  async isCustom() {
    return await this.account.getConfig()
      .getBoolean(CONFIG_KEY_IS_CUSTOM, false);
  }

  /**
   * @inheritdoc
   */
  async getDisplayName() {
    if (await this.isCustom())
      return (await this.account.getConfig()
        .getString(CONFIG_KEY_DISPLAY_NAME, "Unnamed Account")).trim();

    return (await browser.sieve.accounts.getPrettyName(this.account.getId())).trim();
  }

  /**
   * Sets the display name of a custom server.
   *
   * @param {string} value
   *   the display name.
   * @returns {SieveMozHost}
   *   a self reference.
   */
  async setDisplayName(value) {
    await this.account.getConfig()
      .setString(CONFIG_KEY_DISPLAY_NAME, `${value}`.trim());
    return this;
  }

  /**
   * @inheritdoc
   */
  async getHostname() {
    if (await this.isCustom())
      return (await this.account.getConfig()
        .getString(CONFIG_KEY_HOSTNAME, "")).trim();

    return (await browser.sieve.accounts.getHostname(this.account.getId())).trim();
  }

  /**
   * Sets the hostname of a custom server.
   *
   * @param {string} hostname
   *   the ManageSieve hostname.
   * @returns {SieveMozHost}
   *   a self reference.
   */
  async setHostname(hostname) {
    await this.account.getConfig()
      .setString(CONFIG_KEY_HOSTNAME, `${hostname}`.trim());
    return this;
  }

  /**
   * @inheritdoc
   */
  async getKeepAlive() {
    return await this.account.getConfig().getInteger(CONFIG_KEEP_ALIVE_INTERVAL, FIVE_MINUTES);
  }
}

export { SieveMozHost as SieveHost };
