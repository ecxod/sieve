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
import { SieveSession } from "./libs/libManageSieve/SieveSession.mjs";
import { SieveCertValidationException } from "./libs/libManageSieve/SieveExceptions.mjs";

import { SieveLogger } from "./libs/managesieve.ui/utils/SieveLogger.mjs";
import { SieveIpcClient } from "./libs/managesieve.ui/utils/SieveIpcClient.mjs";
import { SieveAccounts } from "./libs/managesieve.ui/settings/logic/SieveAccounts.mjs";
import { captureException, initSentry } from "./libs/managesieve.ui/utils/SieveSentry.mjs";
import {
  binaryStringToBytes,
  cleanSpamMessage,
  findSpecialFolder,
  replaceDuplicateMessages
} from "./libs/managesieve.ui/spam/SieveSpamMessage.mjs";

initSentry("background");

(async function () {

  const ERROR_UNTRUSTED = 1;
  const ERROR_MISMATCH = 2;
  const ERROR_TIME = 4;

  const FIRST_ENTRY = 0;
  const HAM_TRAINING_TAG = "rspamdham";
  const PERMANENT_ALLOW_TAG = "rspamdallow";
  const PERMANENT_ALLOW_FAILED_TAG = "rspamdallowfailed";

  const logger = SieveLogger.getInstance();

  const accounts = await (new SieveAccounts().load());

  const sessions = new Map();

  /**
   * Creates the internal Thunderbird tag used as an authenticated IMAP signal
   * for the local Rspamd training helper.
   *
   * @param {string} key
   *   stable Thunderbird tag and IMAP keyword.
   * @param {string} label
   *   user-visible internal tag label.
   * @param {string} color
   *   tag color.
   */
  async function ensureInternalTag(key, label, color) {
    const tags = await browser.messages.tags.list();

    if (tags.some((tag) => {return tag.key === key;}))
      return;

    await browser.messages.tags.create(key, label, color);
  }

  /**
   * Loads an account including its complete folder tree.
   *
   * @param {string} id
   *   Thunderbird account id.
   * @returns {Promise<object>}
   *   the Thunderbird mail account.
   */
  async function getMailAccount(id) {
    try {
      return await browser.accounts.get(id, true);
    } catch {
      return await browser.accounts.get(id);
    }
  }

  /**
   * Collects every page returned by the Thunderbird messages API.
   *
   * @param {object} folder
   *   source folder.
   * @returns {Promise<object[]>}
   *   all message headers in the folder.
   */
  async function listFolderMessages(folder) {
    const messages = [];
    let page = await browser.messages.list(folder);

    while (page) {
      messages.push(...page.messages);
      if (!page.id)
        break;
      page = await browser.messages.continueList(page.id);
    }

    return messages;
  }

  /**
   * Finds every message with an exact RFC 822 Message-ID in one folder.
   *
   * @param {object} folder
   *   folder to search.
   * @param {string} headerMessageId
   *   Message-ID without surrounding angle brackets.
   * @returns {Promise<object[]>}
   *   all matching message headers.
   */
  async function findMessagesByHeaderId(folder, headerMessageId) {
    if (!headerMessageId)
      return [];

    const query = { headerMessageId };
    if (folder.id)
      query.folderId = folder.id;
    else
      query.folder = folder;

    const messages = [];
    let page = await browser.messages.query(query);
    while (page) {
      messages.push(...page.messages);
      if (!page.id)
        break;
      page = await browser.messages.continueList(page.id);
    }
    return messages;
  }

  /**
   * Normalizes getRaw() results across Thunderbird versions.
   *
   * @param {number} id
   *   Thunderbird message id.
   * @returns {Promise<Uint8Array>}
   *   complete RFC 822 bytes.
   */
  async function getRawMessageBytes(id) {
    let raw;

    try {
      raw = await browser.messages.getRaw(id, { "data_format": "File" });
    } catch {
      raw = await browser.messages.getRaw(id);
    }

    if (typeof raw === "string")
      return binaryStringToBytes(raw);

    if (raw && typeof raw.arrayBuffer === "function")
      return new Uint8Array(await raw.arrayBuffer());

    throw new Error("Thunderbird did not return readable message source");
  }

  /**
   * Compares folders using current ids or legacy account/path pairs.
   *
   * @param {object} left
   *   first Thunderbird folder.
   * @param {object} right
   *   second Thunderbird folder.
   * @returns {boolean}
   *   true when both objects identify the same folder.
   */
  function isSameFolder(left, right) {
    if (!left || !right)
      return false;

    if (left.id && right.id)
      return left.id === right.id;

    return left.accountId === right.accountId && left.path === right.path;
  }

  /**
   * Runs a replacement operation after removing Inbox copies with the same Message-ID.
   * Existing content is kept in memory and restored if the replacement fails.
   *
   * @param {object} inbox
   *   destination folder.
   * @param {string} headerMessageId
   *   Message-ID of the replacement.
   * @param {Function} replacement
   *   operation that places the replacement in the Inbox.
   * @returns {Promise<object>}
   *   replacement result.
   */
  async function replaceInboxDuplicates(inbox, headerMessageId, replacement) {

    const duplicates = await findMessagesByHeaderId(inbox, headerMessageId);
    return await replaceDuplicateMessages({
      hasDuplicates: duplicates.length > 0,
      createBackup: async () => {
        const previous = duplicates[0];
        return {
          data: await getRawMessageBytes(previous.id),
          flagged: !!previous.flagged,
          junk: !!previous.junk,
          read: !!previous.read,
          tags: previous.tags || []
        };
      },
      removeDuplicates: async () => {
        await browser.messages.delete(
          duplicates.map((message) => {return message.id;}), true);
      },
      importReplacement: replacement,
      restoreBackup: async (backup) => {
        const backupFile = new File([backup.data], "previous-inbox-message.eml", {
          type: "message/rfc822"
        });
        const restored = await browser.messages.import(backupFile, inbox, {
          flagged: backup.flagged,
          read: backup.read,
          tags: backup.tags
        });
        await browser.messages.update(restored.id, { junk: backup.junk });
      }
    });
  }

  /**
   * Imports a permanently cleaned copy, marks it as ham, and removes the
   * original only after the copy exists in the inbox.
   *
   * @param {object} message
   *   Thunderbird message header.
   * @param {object} inbox
   *   destination inbox folder.
   * @param {boolean} permanentAllow
   *   queue an authenticated permanent sender allowlist request.
   * @returns {Promise<object>}
   *   per-message operation summary.
   */
  async function cleanAndMoveSpamMessage(message, inbox, permanentAllow) {
    const cleaned = cleanSpamMessage(await getRawMessageBytes(message.id));
    const sourceChanged = cleaned.subjectChanged || cleaned.headersRemoved > 0;
    const queuedTags = [HAM_TRAINING_TAG];
    if (permanentAllow)
      queuedTags.push(PERMANENT_ALLOW_TAG);
    const tags = [...new Set([...(message.tags || []), ...queuedTags])];

    if (!sourceChanged) {
      await replaceInboxDuplicates(inbox, message.headerMessageId, async () => {
        await browser.messages.update(message.id, { junk: false, tags });
        await browser.messages.move([message.id], inbox);
      });
      return {
        id: message.id,
        subjectChanged: false,
        headersRemoved: 0
      };
    }

    if (typeof browser.messages.import !== "function") {
      throw new Error(
        "This Thunderbird version cannot permanently remove the spam prefix");
    }

    const file = new File([cleaned.data], "unspammed-message.eml", {
      type: "message/rfc822"
    });
    const imported = await replaceInboxDuplicates(
      inbox, message.headerMessageId, async () => {
        return await browser.messages.import(file, inbox, {
          flagged: !!message.flagged,
          read: !!message.read,
          tags
        });
      });

    if (!imported || typeof imported.id === "undefined")
      throw new Error("Thunderbird did not confirm the imported inbox message");

    await browser.messages.update(imported.id, { junk: false });
    await browser.messages.delete([message.id], true);

    return {
      id: message.id,
      importedId: imported.id,
      subjectChanged: cleaned.subjectChanged,
      headersRemoved: cleaned.headersRemoved
    };
  }
  // TODO Extract into separate class..
  /**
   * Gets a tab by its script and account name.
   *
   * @param {string} account
   *   the account name
   * @param {string} name
   *   the script name
   *
   * @returns {*}
   *   the webextension tab object.
   */
  async function getTabs(account, name) {
    const url = new URL("./libs/managesieve.ui/editor.html", window.location);

    url.searchParams.append("account", account);
    url.searchParams.append("script", name);

    return await browser.tabs.query({ url: url.toString() });
  }

  /**
   *
   * @param {*} tab
   */
  async function showTab(tab) {

    await browser.tabs.update(
      tab.id,
      { active: true }
    );

    await browser.windows.update(
      tab.windowId,
      { focused: true }
    );
  }

  browser.tabs.onRemoved.addListener(async () => {

    const url = new URL("./libs/managesieve.ui/*", window.location);
    const tabs = await browser.tabs.query({ url: url.toString() });

    if (tabs.length)
      return;

    for (const id of accounts.getAccountIds()) {
      if (!sessions.has(id))
        continue;

      const session = sessions.get(id);
      sessions.delete(id);

      try {
        await session.disconnect(true);
      } catch (ex) {
        // Closing the last Sieve tab abandons all pending requests. Their
        // timeout exceptions describe this intentional cleanup and must not
        // become unhandled errors or Sentry events.
        logger.logAction(`Session cleanup completed with ${ex.message || ex}`);
      }
    }
  });

  // ------------------------------------------------------------------------ //

  /**
   * Populates thunderbird's menus.
   *
   * @param {window} window
   *   the window to which the menu items should be added.
   */
  async function populateMenus(window) {

    // We can skip in case it is not a normal window.
    if (`${window.type}` !== "normal")
      return;

    const id = `${window.id}`;

    try {
      // Thunderbird has changed these menu nodes several times. Missing legacy
      // nodes are normal and should not create rejected Experiment promises.
      if (await browser.sieve.menu.has(id, "filtersCmd")) {
        await browser.sieve.menu.add(id, {
          "id": "mnuSieveListDialog",
          "type": "menu-label",
          "reference": "filtersCmd",
          "position": "before",
          "label": browser.i18n.getMessage("menuTitle"),
          "accesskey": browser.i18n.getMessage("menuAccessKey")
        });

        await browser.sieve.menu.add(id, {
          "id": "mnuSieveSeparator",
          "type": "menu-separator",
          "reference": "filtersCmd",
          "position": "before"
        });
      }

      // The app-menu filter entry moved in Thunderbird 68 and may be absent in
      // newer Thunderbird versions.
      let ref = null;

      if (await browser.sieve.menu.has(id, "appmenu_filtersCmd"))
        ref = "appmenu_filtersCmd";
      else if (await browser.sieve.menu.has(id, "appmenu_FilterMenu"))
        ref = "appmenu_FilterMenu";

      if (!ref)
        return;

      await browser.sieve.menu.add(id, {
        "id": "appMenuSieveListDialog",
        "type": "appmenu-label",
        "reference": ref,
        "label": browser.i18n.getMessage("menuTitle"),
        "accesskey":browser.i18n.getMessage("menuAccessKey"),
        "position": "before"
      });

      await browser.sieve.menu.add(id, {
        "id": "appMenuSieveSeparator",
        "type": "appmenu-separator",
        "reference": ref,
        "position": "before"
      });
    } catch (ex) {
      console.error("Could not populate the Thunderbird menus", ex);
      await captureException(ex, {
        action: "populate-menus",
        windowId: id,
        windowType: `${window.type}`
      });
    }
  }

  await browser.sieve.menu.onCommand.addListener(
    async () => {
      const url = new URL("./libs/managesieve.ui/accounts.html", window.location);

      const tabs = await browser.tabs.query({ url: url.toString() });

      if (tabs.length) {
        await showTab(tabs[FIRST_ENTRY]);
        return;
      }

      await browser.tabs.create({
        active: true,
        url: "./libs/managesieve.ui/accounts.html"
      });
    });


  for (const window of await browser.windows.getAll()) {
    await populateMenus(window);
  }

  browser.windows.onCreated.addListener((window) => {
    populateMenus(window).catch((ex) => {
      console.error("Could not initialize a newly created window", ex);
    });
  });


  // ------------------------------------------------------------------------ //

  const actions = {
    // account endpoints...
    "accounts-list": async function () {
      logger.logAction("List Accounts");
      await accounts.load();
      return await accounts.getAccountIds();
    },

    "account-create": async function (msg) {
      logger.logAction("Create custom Sieve server");
      return await accounts.create(msg.payload);
    },

    "account-delete": async function (msg) {
      const id = msg.payload.account;
      const account = accounts.getAccountById(id);

      if (!account)
        return false;

      const host = await account.getHost();
      const confirmed = await SieveIpcClient.sendMessage(
        "accounts", "account-show-delete", await host.getDisplayName());

      if (!confirmed)
        return false;

      if (sessions.has(id))
        await actions["account-disconnect"](msg);

      return await accounts.remove(id);
    },

    "account-get-displayname": async function (msg) {
      const host = await accounts.getAccountById(msg.payload.account).getHost();
      return await host.getDisplayName();
    },

    "account-spam-list": async function (msg) {
      const id = msg.payload.account;
      const account = await getMailAccount(id);
      const junk = findSpecialFolder(account, "junk");
      const inbox = findSpecialFolder(account, "inbox");

      if (!junk)
        throw new Error("Thunderbird has no spam folder for this account");
      if (!inbox)
        throw new Error("Thunderbird has no inbox for this account");

      const messages = await listFolderMessages(junk);
      messages.sort((left, right) => {return new Date(right.date) - new Date(left.date);});

      return {
        folderName: junk.name || "Spam",
        canCleanSource: typeof browser.messages.import === "function",
        messages: messages.map((message) => {
          return {
            id: message.id,
            author: message.author || "",
            date: message.date ? new Date(message.date).toISOString() : "",
            junk: !!message.junk,
            recipients: message.recipients || [],
            subject: message.subject || ""
          };
        })
      };
    },

    "account-spam-unspam": async function (msg) {
      const id = msg.payload.account;
      const permanentAllow = msg.payload.permanentAllow === true;
      const requested = Array.isArray(msg.payload.messageIds)
        ? [...new Set(msg.payload.messageIds)] : [];

      if (!requested.length)
        return { processed: 0, subjectPrefixesRemoved: 0, headersRemoved: 0 };

      const account = await getMailAccount(id);
      const junk = findSpecialFolder(account, "junk");
      const inbox = findSpecialFolder(account, "inbox");

      if (!junk || !inbox)
        throw new Error("Thunderbird could not find the spam folder or inbox");

      await ensureInternalTag(
        HAM_TRAINING_TAG, "Rspamd: Ham-Training (intern)", "#808080");
      if (permanentAllow) {
        await ensureInternalTag(
          PERMANENT_ALLOW_TAG,
          "Rspamd: dauerhafte Freigabe ausstehend (intern)",
          "#008000");
        await ensureInternalTag(
          PERMANENT_ALLOW_FAILED_TAG,
          "Rspamd: dauerhafte Freigabe abgelehnt (keine DMARC-Bestätigung)",
          "#cc0000");
      }

      const results = [];
      for (const messageId of requested) {
        const message = await browser.messages.get(messageId);

        if (!message.folder || !isSameFolder(message.folder, junk))
          throw new Error("A selected message is no longer in this account's spam folder");

        results.push(await cleanAndMoveSpamMessage(message, inbox, permanentAllow));
      }

      return {
        processed: results.length,
        hamTrainingQueued: results.length,
        permanentAllowQueued: permanentAllow ? results.length : 0,
        subjectPrefixesRemoved: results.filter((item) => {return item.subjectChanged;}).length,
        headersRemoved: results.reduce((total, item) => {return total + item.headersRemoved;}, 0)
      };
    },

    "account-filters-list": async function (msg) {
      const id = msg.payload.account;
      logger.logAction(`List Thunderbird filters for ${id}`);
      return await browser.sieve.accounts.getFilters(id);
    },

    "account-filter-delete": async function (msg) {
      const id = msg.payload.account;
      logger.logAction(`Delete imported Thunderbird filter for ${id}`);
      return await browser.sieve.accounts.removeFilter(
        id, msg.payload.index, msg.payload.deleteToken);
    },

    "account-filter-edit": async function (msg) {
      const id = msg.payload.account;
      logger.logAction(`Open Thunderbird filter editor for ${id}`);
      return await browser.sieve.accounts.editFilter(
        id, msg.payload.index, msg.payload.stateToken);
    },

    "account-filter-scripts": async function (msg) {
      const id = msg.payload.account;
      logger.logAction(`Load server scripts for Thunderbird filter comparison on ${id}`);

      if (!sessions.has(id) || !sessions.get(id).isConnected())
        return { connected: false, scripts: [] };

      const session = sessions.get(id);
      const scripts = [];
      for (const item of await session.listScripts()) {
        scripts.push({
          name: item.script,
          active: !!item.active,
          content: await session.getScript(item.script)
        });
      }

      return { connected: true, scripts: scripts };
    },

    "account-filter-script-save": async function (msg) {
      const id = msg.payload.account;
      const name = msg.payload.name;
      const expected = msg.payload.expected;
      const script = msg.payload.script;
      logger.logAction(`Save imported Thunderbird filter to ${name} on ${id}`);

      if (!sessions.has(id) || !sessions.get(id).isConnected())
        throw new Error("The Sieve server is not connected.");

      const session = sessions.get(id);
      const current = await session.getScript(name);
      if (current !== expected) {
        throw new Error(
          "The server script changed after it was loaded. Refresh the filter table and try again.");
      }

      await session.checkScript(script);
      await session.putScript(name, script);

      return { name: name };
    },

    "account-is-connecting": function(msg) {
      logger.logAction(`Is connecting ${msg.payload.account}`);

      if (!sessions.has(msg.payload.account))
        return false;

      return sessions.get(msg.payload.account).isConnecting();
    },

    "account-connected": function (msg) {
      logger.logAction(`Is connected ${msg.payload.account}`);

      if (!sessions.has(msg.payload.account))
        return false;

      return sessions.get(msg.payload.account).isConnected();
    },

    "account-connect": async function (msg) {

      const id = msg.payload.account;
      const account = await accounts.getAccountById(id);

      logger.logAction(`Connect ${id}`);

      if (sessions.has(id)) {
        const session = sessions.get(id);
        if (session.isConnected() || session.isConnecting())
          return;

        await session.disconnect(id);
        sessions.delete(id);
      }

      const host = await account.getHost();
      const security = await account.getSecurity();
      const settings = await account.getSettings();
      const hostname = await host.getHostname();
      const port = await host.getPort();

      const options = {
        "security": await security.getTLS(),
        "sasl": await security.getMechanism(),
        "keepAlive": await host.getKeepAlive(),
        "logLevel": await settings.getLogLevel()
      };

      const onAuthenticate = async (hasPassword) => {

        logger.logAction(`OnAuthenticate`);

        const authentication = await account.getAuthentication();

        const credentials = {};
        credentials.username = await authentication.getUsername();

        if (hasPassword)
          credentials.password = await authentication.getPassword();

        return credentials;
      };

      const onAuthorize = async () => {

        logger.logAction(`onAuthorize`);

        // We do not support authorization in the web extension
        return "";
      };

      sessions.set(id,
        new SieveSession(id, options));

      sessions.get(id).on("authenticate",
        async (hasPassword) => { return await onAuthenticate(hasPassword); });
      sessions.get(id).on("authorize",
        async () => { return await onAuthorize(); });

      try {
        await sessions.get(id).connect(await host.getUrl());

        // Connection established, this means we need to listen for any
        // unplanned disconnects.
        sessions.get(id).on("disconnected", async () => {
          await SieveIpcClient.sendMessage("accounts", "account-disconnected", id);
        });

      } catch (ex) {

        const errorMessage = `${ex.message || ex} (Server: ${hostname}:${port})`;

        captureException(ex, {
          action: "account-connect",
          hostname: hostname,
          port: port,
          sasl: options.sasl,
          security: options.security,
          stage: "connection-handshake"
        });

        await (actions["account-disconnect"](msg));

        if (ex instanceof SieveCertValidationException) {
          const secInfo = ex.getSecurityInfo();

          const rv = (await SieveIpcClient.sendMessage(
            "accounts", "account-show-certerror", secInfo));

          // Dialog was canceled we bail out.
          if (!rv)
            return;

          let overrideBits = 0;
          if (secInfo.isNotValidAtThisTime)
            overrideBits |= ERROR_TIME;

          if (secInfo.isUntrusted)
            overrideBits |= ERROR_UNTRUSTED;

          if (secInfo.isDomainMismatch)
            overrideBits |= ERROR_MISMATCH;

          await (browser.sieve.socketV4.addCertErrorOverride(
            secInfo.host, `${secInfo.port}`, secInfo.rawDER, overrideBits));

          await (actions["account-connect"](msg));
          return;
        }

        // connecting failed for some reason, which means we
        // need to handle the error.
        logger.logAction("Connecting failed due to an error " + ex);

        await SieveIpcClient.sendMessage(
          "accounts", "account-show-error", errorMessage);
      }
    },

    "account-disconnect": async function (msg) {
      logger.logAction(`Disconnect ${msg.payload.account}`);
      const id = msg.payload.account;
      if (!sessions.has(id))
        return;

      await (sessions.get(id).disconnect(msg.payload.account));
      sessions.delete(id);
    },

    "account-list": async function (msg) {
      logger.logAction(`List scripts for ${msg.payload.account}`);
      return await sessions.get(msg.payload.account).listScripts();
    },

    "account-capabilities": async function (msg) {
      logger.logAction(`Get capabilities for ${msg.payload.account}`);
      return await sessions.get(msg.payload.account).capabilities();
    },

    // Script endpoint...
    "script-create": async function (msg) {
      const account = msg.payload.account;

      logger.logAction(`Create script for ${account}`);

      const name = (await SieveIpcClient.sendMessage(
        "accounts", "script-show-create", account)).trim();

      if (name !== "")
        await sessions.get(account).putScript(name, "#test\r\n");

      return name;
    },

    "script-rename": async function (msg) {
      const account = msg.payload.account;
      const oldName = msg.payload.data;

      logger.logAction(`Rename Script ${oldName} for account: ${account}`);

      if ((await getTabs(account, oldName)).length) {
        await SieveIpcClient.sendMessage("accounts", "script-show-busy", oldName);
        return false;
      }

      const newName = (await SieveIpcClient.sendMessage(
        "accounts", "script-show-rename", oldName)).trim();

      if (newName === oldName)
        return false;

      await sessions.get(account).renameScript(oldName, newName);
      return true;
    },

    "script-delete": async function (msg) {
      const account = msg.payload.account;
      const name = msg.payload.data;

      logger.logAction(`Delete Script ${name} for account: ${account}`);

      if ((await sessions.get(account).listScripts())
        .some((script) => { return script.script === name && script.active; }))
        return false;

      if ((await getTabs(account, name)).length) {
        await SieveIpcClient.sendMessage("accounts", "script-show-busy", name);
        return false;
      }

      const rv = await SieveIpcClient.sendMessage("accounts", "script-show-delete", name);

      if (rv === true)
        await sessions.get(account).deleteScript(name);

      return rv;
    },

    "script-activate": async function (msg) {
      const account = msg.payload.account;
      const name = msg.payload.data;

      logger.logAction(`Activate ${name} for ${account}`);

      await sessions.get(account).activateScript(name);
    },

    "script-deactivate": async function (msg) {
      const account = msg.payload.account;

      logger.logAction(`Deactivate script for ${account}`);

      await sessions.get(account).activateScript();
    },

    "script-edit": async function (msg) {

      const name = msg.payload.data;
      const account = msg.payload.account;

      logger.logAction(`Edit ${name} on ${account}`);

      const url = new URL("./libs/managesieve.ui/editor.html", window.location);

      url.searchParams.append("account", account);
      url.searchParams.append("script", name);

      const tabs = await getTabs(account, name);
      if (tabs.length) {
        await showTab(tabs[FIRST_ENTRY]);
        return;
      }

      // create a new tab...
      await browser.tabs.create({
        active: true,
        url: url.toString()
      });
    },

    "script-get": async function (msg) {
      const name = msg.payload.data;
      const account = msg.payload.account;

      logger.logAction(`Get ${name} for ${account}`);

      return await sessions.get(account).getScript(name);
    },

    "script-check": async function (msg) {
      const account = msg.payload.account;
      const script = msg.payload.data;

      logger.logAction(`Check Script for ${account}`);

      try {
        await sessions.get(account).checkScript(script);
      } catch (ex) {
        // FIXME We need to rethrow incase checkscript returns a SieveServerException.
        return ex.getResponse().getMessage();
      }

      return "";
    },

    "script-save": async function (msg) {
      const account = msg.payload.account;
      const name = msg.payload.name;
      const script = msg.payload.script;

      logger.logAction(`Save ${name} for ${account}`);

      await sessions.get(account).putScript(name, script);
    },

    "account-get-settings": async function (msg) {

      logger.logAction(`Get settings for ${msg.payload.account}`);

      const account = accounts.getAccountById(msg.payload.account);
      const host = await account.getHost();
      const authentication = await account.getAuthentication();
      const security = await account.getSecurity();

      return {
        displayName: await host.getDisplayName(),
        hostname: await host.getHostname(),
        port: await host.getPort(),
        custom: await account.getConfig().getBoolean("custom", false),
        developer: await accounts.getDeveloper(),

        security: await security.getTLS(),
        mechanism: await security.getMechanism(),

        username: await authentication.getUsername()
      };
    },

    // eslint-disable-next-line no-unused-vars
    "settings-get-loglevel": async function (msg) {
      return await accounts.getLogLevel();
    },

    // eslint-disable-next-line no-unused-vars
    "settings-get-theme": async function (msg) {
      return await accounts.getTheme();
    },

    "settings-set-theme": async function (msg) {
      await accounts.setTheme(msg.payload.theme);
    },

    "account-settings-get-collapsed": async function (msg) {
      return await accounts.getAccountById(msg.payload.account)
        .getSettings().getUiCollapsed();
    },

    "account-settings-set-collapsed": async function (msg) {
      await accounts.getAccountById(msg.payload.account)
        .getSettings().setUiCollapsed(msg.payload.collapsed);
    },

    "account-settings-set-debug": async function (msg) {

      logger.logAction(`Set Debug Level for ${msg.payload.account}`);

      const account = accounts.getAccountById(msg.payload.account);

      await account.getSettings().setLogLevel(msg.payload.levels.account);
      await accounts.setLogLevel(msg.payload.levels.global);
    },

    "account-settings-get-debug": async function (msg) {

      logger.logAction(`Get Debug Level for ${msg.payload.account}`);

      const account = accounts.getAccountById(msg.payload.account);

      return {
        "account": await account.getSettings().getLogLevel(),
        "global": await accounts.getLogLevel()
      };
    },

    "get-preference": async (msg) => {

      const name = msg.payload.data;
      const account = msg.payload.account;

      logger.logAction(`Set value ${name} on ${account}`);

      const value = await accounts.getAccountById(account).getEditor().getValue(name);

      if (value === null)
        return await actions["get-default-preference"](msg);

      return value;
    },

    "get-default-preference": async (msg) => {
      const name = msg.payload.data;

      logger.logAction(`Get default value for ${name}`);

      return await accounts.getEditor().getValue(name);
    },

    "set-preference": async (msg) => {
      const name = msg.payload.key;
      const value = msg.payload.value;
      const account = msg.payload.account;

      logger.logAction(`Set value ${name} on ${account}`);

      await accounts.getAccountById(account).getEditor().setValue(name, value);
    },

    "set-default-preference": async (msg) => {
      const name = msg.payload.key;
      const value = msg.payload.value;

      logger.logAction(`Set default value for ${name}`);

      await accounts.getEditor().setValue(name, value);
    }
  };

  for (const [key, value] of Object.entries(actions)) {
    SieveIpcClient.setRequestHandler("core", key, value);
  }

})(this);
