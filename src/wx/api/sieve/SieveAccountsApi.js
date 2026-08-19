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

(function (exports) {

  /* global ExtensionCommon */
  /* global Components */

  const Cc = Components.classes;
  const Ci = Components.interfaces;

  /**
   * Get the incoming server for the given account id.
   *
   * @param {string} account
   *   the account id
   * @returns {Components.interfaces.nsIMsgAccountManager}
   *   a reference to the incoming server.
   */
  function getIncomingServer(account) {
    return Cc['@mozilla.org/messenger/account-manager;1']
      .getService(Ci.nsIMsgAccountManager)
      .getAccount(account)
      .incomingServer;
  }

  /**
   * Returns the first non-empty value from the given candidates.
   *
   * @param {...string} values
   *   the values to inspect.
   * @returns {string}
   *   the first non-empty string or an empty string.
   */
  function firstDefined(...values) {
    for (const value of values) {
      if (typeof (value) === "undefined" || value === null)
        continue;

      const result = `${value}`;

      if (result !== "")
        return result;
    }

    return "";
  }

  /**
   * Gets a property from a XPCOM object without failing if it does not exist.
   *
   * @param {object} item
   *   The object which should be inspected.
   * @param {string} name
   *   The property's name.
   * @returns {string}
   *   The property's string value or an empty string.
   */
  function getProperty(item, name) {
    try {
      return firstDefined(item[name]);
    } catch {
      return "";
    }
  }

  /**
   * Extracts a hostname from an IMAP/POP server URI.
   *
   * @param {string} uri
   *   The server URI.
   * @returns {string}
   *   The hostname or an empty string.
   */
  function getHostnameFromUri(uri) {
    if (uri === "")
      return "";

    try {
      const url = new URL(uri);
      return url.hostname;
    } catch {
      return "";
    }
  }

  /**
   * Implements a webextension api for sieve session and connection management.
   */
  class SieveAccountsApi extends ExtensionCommon.ExtensionAPI {
    /**
     * @inheritdoc
     */
    getAPI() {

      return {
        sieve: {
          accounts: {

            async getPrettyName(id) {
              return await getIncomingServer(id).prettyName;
            },

            async getPassword(id) {
              const server = getIncomingServer(id);

              // in case the passwordPromptRequired attribute is true...
              // ... thunderbird will take care on retrieving a valid password...
              if (server.passwordPromptRequired === false)
                return await server.password;

              return await undefined;
            },

            async getUsername(id) {
              const server = getIncomingServer(id);

              return await firstDefined(
                getProperty(server, "realUsername"),
                getProperty(server, "username"),
                getProperty(server, "userName"));
            },

            async getHostname(id) {
              const server = getIncomingServer(id);

              return await firstDefined(
                getProperty(server, "realHostName"),
                getProperty(server, "hostName"),
                getProperty(server, "realHostname"),
                getProperty(server, "hostname"),
                getHostnameFromUri(getProperty(server, "serverURI")),
                getHostnameFromUri(getProperty(server, "serverUri")),
                getHostnameFromUri(getProperty(server, "URI")));
            }
          }
        }
      };
    }
  }

  exports.SieveAccountsApi = SieveAccountsApi;

})(this);
