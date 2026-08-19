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


import {
  SieveAbstractSecurity,
  SECURITY_EXPLICIT
} from "./SieveAbstractSecurity.mjs";

const PREF_MECHANISM = "security.mechanism";
const PREF_TLS = "security.tls";
const DEFAULT_MECHANISM = "CRAM-MD5";

/**
 * Manages Thunderbird specific Sieve security settings.
 */
class SieveSecurity extends SieveAbstractSecurity {

  /**
   * @inheritdoc
   */
  async getMechanism() {
    const mechanism = await this.account.getConfig()
      .getString(PREF_MECHANISM, DEFAULT_MECHANISM);

    if (mechanism === "default")
      return DEFAULT_MECHANISM;

    return mechanism;
  }

  /**
   * @inheritdoc
   */
  async getTLS() {
    return await this.account.getConfig().getInteger(PREF_TLS, SECURITY_EXPLICIT);
  }
}

export { SieveSecurity };
