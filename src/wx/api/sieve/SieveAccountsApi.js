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
  const UNKNOWN_VALUE = -1;
  const DISPLAY_INDEX_OFFSET = 1;
  const INBOX_REFRESH_TIMEOUT = 30000;

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
   * Reads a privileged XPCOM property which may throw for the current value
   * type.
   *
   * @param {object} item
   *   the XPCOM object.
   * @param {string} name
   *   the property name.
   * @param {*} fallback
   *   the serializable fallback value.
   * @returns {*}
   *   the property value or the fallback.
   */
  function readProperty(item, name, fallback = null) {
    try {
      const value = item[name];
      if (typeof value === "undefined")
        return fallback;
      return value;
    } catch {
      return fallback;
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
   * Resolves an incoming server hostname across Thunderbird API generations.
   *
   * @param {object} server
   *   Thunderbird incoming server.
   * @returns {string}
   *   hostname or an empty string.
   */
  function getIncomingServerHostname(server) {
    return firstDefined(
      getProperty(server, "realHostName"),
      getProperty(server, "hostName"),
      getProperty(server, "realHostname"),
      getProperty(server, "hostname"),
      getHostnameFromUri(getProperty(server, "serverURI")),
      getHostnameFromUri(getProperty(server, "serverUri")),
      getHostnameFromUri(getProperty(server, "URI")));
  }

  /**
   * Synchronizes the Thunderbird Inbox database with the incoming server.
   *
   * WebExtension messages.list() reads Thunderbird's local folder database.
   * A direct IMAP Sieve operation can therefore leave it stale until the
   * folder is explicitly updated.
   *
   * @param {string} account
   *   Thunderbird account id.
   * @returns {Promise<void>}
   *   fulfilled after Thunderbird reports that the Inbox was loaded.
   */
  async function refreshInbox(account) {
    const server = getIncomingServer(account);
    const folder = server.rootFolder
      .getFolderWithFlags(Ci.nsMsgFolderFlags.Inbox);
    if (!folder)
      throw new Error("Thunderbird did not report an Inbox for this account");

    const mailSession = Cc["@mozilla.org/messenger/services/session;1"]
      .getService(Ci.nsIMsgMailSession);

    await new Promise((resolve, reject) => {
      let finished = false;
      let listener = null;
      const timer = Cc["@mozilla.org/timer;1"]
        .createInstance(Ci.nsITimer);

      const finish = (error) => {
        if (finished)
          return;

        finished = true;
        timer.cancel();
        mailSession.RemoveFolderListener(listener);
        if (error)
          reject(error);
        else
          resolve();
      };

      listener = {
        onFolderEvent(eventFolder, event) {
          if (event !== "FolderLoaded"
              || getProperty(eventFolder, "URI") !== getProperty(folder, "URI"))
            return;

          finish();
        }
      };

      mailSession.AddFolderListener(listener, Ci.nsIFolderListener.event);
      timer.initWithCallback(() => {
        finish(new Error("Timed out while refreshing the Thunderbird Inbox"));
      }, INBOX_REFRESH_TIMEOUT, Ci.nsITimer.TYPE_ONE_SHOT);

      try {
        folder.updateFolder(null);
      } catch (ex) {
        finish(ex);
      }
    });
  }

  /**
   * Returns direct IMAP connection details and the server-side Sent path.
   *
   * @param {string} account
   *   Thunderbird account id.
   * @returns {object}
   *   serializable IMAP connection details.
   */
  function getImapConnection(account) {
    const server = getIncomingServer(account);
    if (`${readProperty(server, "type", "")}`.toLowerCase() !== "imap")
      throw new Error("Applying a Sieve script to Sent requires an IMAP account");

    const socketType = readProperty(server, "socketType", -1);
    let security = "";
    if (socketType === Ci.nsMsgSocketType.SSL)
      security = "tls";
    else if (socketType === Ci.nsMsgSocketType.alwaysSTARTTLS)
      security = "starttls";
    else
      throw new Error("The IMAP account must use TLS or STARTTLS");

    const folder = server.rootFolder
      .getFolderWithFlags(Ci.nsMsgFolderFlags.SentMail);
    if (!folder)
      throw new Error("Thunderbird did not report a Sent folder for this account");

    const port = readProperty(server, "port", -1);
    const sentFolder = firstDefined(
      getProperty(folder, "onlineName"),
      getProperty(folder, "name"),
      getProperty(folder, "prettyName"));
    if (!sentFolder)
      throw new Error("Thunderbird did not report the server name of the Sent folder");

    const hostname = getIncomingServerHostname(server);
    if (!hostname)
      throw new Error("Thunderbird did not report the IMAP server hostname");

    return {
      hostname,
      port: port > 0 ? port : (security === "tls" ? 993 : 143),
      security,
      sentFolder
    };
  }

  /**
   * Serializes a Thunderbird search term into plain WebExtension data.
   *
   * @param {nsIMsgSearchTerm} term
   *   the Thunderbird filter term.
   * @returns {object}
   *   a structured-clone compatible representation.
   */
  function serializeTerm(term) {
    const value = readProperty(term, "value", {});
    const folder = readProperty(value, "folder", null);

    return {
      attrib: readProperty(term, "attrib", UNKNOWN_VALUE),
      op: readProperty(term, "op", UNKNOWN_VALUE),
      booleanAnd: !!readProperty(term, "booleanAnd", true),
      beginsGrouping: !!readProperty(term, "beginsGrouping", false),
      endsGrouping: !!readProperty(term, "endsGrouping", false),
      arbitraryHeader: readProperty(term, "arbitraryHeader", ""),
      hdrProperty: readProperty(term, "hdrProperty", ""),
      customId: readProperty(term, "customId", ""),
      original: readProperty(term, "termAsString", ""),
      matchAll: !!readProperty(term, "matchAll", false),
      value: {
        str: readProperty(value, "str", ""),
        utf8Str: readProperty(value, "utf8Str", ""),
        priority: readProperty(value, "priority", null),
        date: readProperty(value, "date", null),
        status: readProperty(value, "status", null),
        size: readProperty(value, "size", null),
        age: readProperty(value, "age", null),
        msgKey: readProperty(value, "msgKey", null),
        junkStatus: readProperty(value, "junkStatus", null),
        junkPercent: readProperty(value, "junkPercent", null),
        folderUri: folder ? readProperty(folder, "URI", "") : ""
      }
    };
  }

  /**
   * Serializes a Thunderbird filter action into plain WebExtension data.
   *
   * @param {nsIMsgRuleAction} action
   *   the Thunderbird filter action.
   * @returns {object}
   *   a structured-clone compatible representation.
   */
  function serializeAction(action) {
    return {
      type: readProperty(action, "type", 0),
      targetFolderUri: readProperty(action, "targetFolderUri", ""),
      strValue: readProperty(action, "strValue", ""),
      priority: readProperty(action, "priority", null),
      junkScore: readProperty(action, "junkScore", null),
      customId: readProperty(action, "customId", "")
    };
  }

  /**
   * Returns a normal JavaScript array for XPCOM array attributes.
   *
   * @param {*} value
   *   an XPCOM or JavaScript array.
   * @param {object} [iface]
   *   the XPCOM interface used by legacy nsIArray values.
   * @returns {Array}
   *   the normalized array.
   */
  function asArray(value, iface) {
    if (!value)
      return [];

    try {
      const result = Array.from(value).filter((item) => { return !!item; });
      if (result.length || !readProperty(value, "length", 0))
        return result;
    } catch {
      // Thunderbird 68 can expose these attributes as legacy nsIArray values.
    }

    const result = [];
    const length = readProperty(value, "length", 0);
    for (let index = 0; index < length; index++) {
      try {
        result.push(value[index] || value.queryElementAt(index, iface));
      } catch {
        // Skip an individual entry which cannot be unwrapped.
      }
    }
    return result;
  }

  /**
   * Gets the filter list which Thunderbird exposes to its filter editor.
   *
   * @param {nsIMsgIncomingServer} server
   *   the owning incoming server.
   * @returns {nsIMsgFilterList}
   *   the mutable user filter list.
   */
  function getEditableFilterList(server) {
    try {
      return server.getEditableFilterList(null);
    } catch {
      return server.getFilterList(null);
    }
  }

  /**
   * Serializes one persistent Thunderbird filter.
   *
   * @param {nsIMsgFilter} filter
   *   the filter to serialize.
   * @param {number} index
   *   its current position in the filter list.
   * @returns {object}
   *   structured-clone compatible filter data with a deletion guard token.
   */
  function serializeFilter(filter, index) {
    const terms = asArray(
      readProperty(filter, "searchTerms", []), Ci.nsIMsgSearchTerm)
      .map((term) => { return serializeTerm(term); });
    let actions = asArray(
      readProperty(filter, "sortedActionList", []), Ci.nsIMsgRuleAction);

    if (!actions.length) {
      const actionCount = readProperty(filter, "actionCount", 0);
      actions = [];
      for (let actionIndex = 0; actionIndex < actionCount; actionIndex++)
        actions.push(filter.getActionAt(actionIndex));
    }

    const result = {
      index: index,
      name: readProperty(filter, "filterName", `Filter ${index + DISPLAY_INDEX_OFFSET}`),
      description: readProperty(filter, "filterDesc", ""),
      enabled: !!readProperty(filter, "enabled", false),
      filterType: readProperty(filter, "filterType", 0),
      unparseable: !!readProperty(filter, "unparseable", false),
      needsMessageBody: !!readProperty(filter, "needsMessageBody", false),
      terms: terms,
      actions: actions.map((action) => { return serializeAction(action); })
    };

    result.deleteToken = JSON.stringify(result);
    return result;
  }

  /**
   * Reads the user-editable Thunderbird message filters for an account.
   * Temporary internal filters are intentionally excluded.
   *
   * @param {string} id
   *   the Thunderbird account id.
   * @returns {object[]}
   *   serialized message filters in Thunderbird execution order.
   */
  function getFilters(id) {
    const server = getIncomingServer(id);
    const list = getEditableFilterList(server);

    const result = [];
    const count = readProperty(list, "filterCount", 0);

    for (let index = 0; index < count; index++) {
      const filter = list.getFilterAt(index);
      if (!filter || readProperty(filter, "temporary", false))
        continue;

      result.push(serializeFilter(filter, index));
    }

    return result;
  }

  /**
   * Resolves a displayed filter only if its current state still matches.
   *
   * @param {string} id
   *   the Thunderbird account id.
   * @param {number} index
   *   the filter's position when it was displayed.
   * @param {string} stateToken
   *   exact serialized state from the displayed table.
   * @returns {object}
   *   filter list, native filter and serialized filter data.
   */
  function getGuardedFilter(id, index, stateToken) {
    const list = getEditableFilterList(getIncomingServer(id));
    const count = readProperty(list, "filterCount", 0);

    if (!Number.isInteger(index) || index < 0 || index >= count)
      throw new Error("The Thunderbird filter list changed. Refresh it and try again.");

    const filter = list.getFilterAt(index);
    if (!filter || readProperty(filter, "temporary", false))
      throw new Error("The selected Thunderbird filter is no longer available.");

    const data = serializeFilter(filter, index);
    if (!stateToken || data.deleteToken !== stateToken)
      throw new Error("The Thunderbird filter changed. Refresh it and try again.");

    return { list: list, filter: filter, data: data };
  }

  /**
   * Removes one unchanged Thunderbird filter and persists the filter file.
   *
   * @param {string} id
   *   the Thunderbird account id.
   * @param {number} index
   *   the filter's position when it was displayed.
   * @param {string} deleteToken
   *   exact serialized state used to prevent deleting a changed filter.
   * @returns {object}
   *   the deleted filter's name.
   */
  function removeFilter(id, index, deleteToken) {
    const current = getGuardedFilter(id, index, deleteToken);

    current.list.removeFilterAt(index);
    current.list.saveToDefaultFile();
    return { name: current.data.name };
  }

  /**
   * Opens Thunderbird's native editor for one unchanged message filter.
   *
   * @param {string} id
   *   the Thunderbird account id.
   * @param {number} index
   *   the filter's position when it was displayed.
   * @param {string} stateToken
   *   exact serialized state from the displayed table.
   * @returns {object}
   *   whether Thunderbird accepted changes in its modal editor.
   */
  function editFilter(id, index, stateToken) {
    const current = getGuardedFilter(id, index, stateToken);
    const wm = Cc["@mozilla.org/appshell/window-mediator;1"]
      .getService(Ci.nsIWindowMediator);
    const owner = wm.getMostRecentWindow("mail:3pane")
      || wm.getMostRecentWindow("mail:messageWindow")
      || wm.getMostRecentWindow(null);

    if (!owner || typeof owner.openDialog !== "function")
      throw new Error("No Thunderbird mail window is available for the filter editor.");

    const args = { filter: current.filter, filterList: current.list };
    owner.openDialog(
      "chrome://messenger/content/FilterEditor.xhtml",
      "FilterEditor",
      "chrome,modal,titlebar,resizable,centerscreen",
      args);

    return { changed: !!args.refresh };
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

              return await getIncomingServerHostname(server);
            },

            async getImapConnection(id) {
              return getImapConnection(id);
            },

            async getFilters(id) {
              return getFilters(id);
            },

            async refreshInbox(id) {
              await refreshInbox(id);
            },

            async removeFilter(id, index, deleteToken) {
              return removeFilter(id, index, deleteToken);
            },

            async editFilter(id, index, stateToken) {
              return editFilter(id, index, stateToken);
            }
          }
        }
      };
    }
  }

  exports.SieveAccountsApi = SieveAccountsApi;

})(this);
