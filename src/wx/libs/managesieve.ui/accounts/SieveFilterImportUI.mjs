/*
 * Read-only Thunderbird message-filter to Sieve comparison table.
 */

import { SieveI18n } from "./../utils/SieveI18n.mjs";
import {
  convertFilter,
  createCombinedScript,
  findImplementations,
  upsertFilterInScript
} from "./../filters/SieveThunderbirdFilterConverter.mjs";

const COPY_CONFIRMATION_MILLISECONDS = 1500;
const DELETE_CONFIRMATION_MILLISECONDS = 5000;

/**
 * Renders one account's Thunderbird filters and generated Sieve stanzas.
 */
class SieveFilterImportUI {

  /**
   * Creates the renderer.
   *
   * @param {SieveAccountUI} account
   *   the owning account UI.
   * @param {HTMLElement} root
   *   the filter tab pane.
   */
  constructor(account, root) {
    this.account = account;
    this.root = root;
    this.conversions = [];
    this.serverScripts = [];
    this.serverConnected = false;
    this.rendering = false;

    root.querySelector(".sieve-filters-refresh")
      .addEventListener("click", () => { this.render(); });
    root.querySelector(".sieve-filters-copy-all")
      .addEventListener("click", async (event) => {
        await this.copy(createCombinedScript(this.conversions), event.currentTarget);
      });
  }

  /**
   * Gets a translation with a bundled fallback.
   *
   * @param {string} key
   *   translation key.
   * @param {string} fallback
   *   fallback text.
   * @returns {string}
   *   translated or fallback text.
   */
  getString(key, fallback) {
    try {
      return SieveI18n.getInstance().getString(key);
    } catch {
      return fallback;
    }
  }

  /**
   * Updates the tab's status box.
   *
   * @param {string} text
   *   status text.
   * @param {string} [style]
   *   Bootstrap alert style.
   */
  setStatus(text, style = "secondary") {
    const status = this.root.querySelector(".sieve-filters-status");
    status.className = `alert alert-${style} py-2 sieve-filters-status`;
    status.textContent = text;
  }

  /**
   * Copies text from a user gesture and reports the result.
   *
   * @param {string} text
   *   text to copy.
   * @param {HTMLElement} button
   *   the clicked button.
   */
  async copy(text, button) {
    if (!text)
      return;

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const input = document.createElement("textarea");
      input.value = text;
      input.setAttribute("readonly", "readonly");
      input.className = "sieve-filter-clipboard-fallback";
      document.body.append(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }

    const previous = button.textContent;
    button.textContent = this.getString("account.filters.copied", "Copied");
    window.setTimeout(
      () => { button.textContent = previous; }, COPY_CONFIRMATION_MILLISECONDS);
  }

  /**
   * Deletes a source filter after a deliberate second click.
   * The server-side Sieve script is never changed by this action.
   *
   * @param {object} conversion
   *   converted filter with its guarded Thunderbird deletion token.
   * @param {HTMLButtonElement} button
   *   the row's deletion button.
   */
  async deleteSourceFilter(conversion, button) {
    if (button.dataset.confirmDelete !== "true") {
      button.dataset.confirmDelete = "true";
      button.classList.remove("btn-outline-danger");
      button.classList.add("btn-danger");
      button.textContent = this.getString(
        "account.filters.delete.confirm", "Click again to delete");

      window.setTimeout(() => {
        if (!button.isConnected || button.dataset.confirmDelete !== "true")
          return;
        delete button.dataset.confirmDelete;
        button.classList.remove("btn-danger");
        button.classList.add("btn-outline-danger");
        button.textContent = this.getString(
          "account.filters.delete", "Delete Thunderbird rule");
      }, DELETE_CONFIRMATION_MILLISECONDS);
      return;
    }

    delete button.dataset.confirmDelete;
    button.setAttribute("disabled", "disabled");

    try {
      const deleted = await this.account.send("account-filter-delete", {
        index: conversion.sourceIndex,
        deleteToken: conversion.deleteToken
      });
      await this.render();
      this.setStatus(`${this.getString(
        "account.filters.deleted",
        "Thunderbird rule deleted; the Sieve rule remains unchanged")}: ${deleted.name}.`, "success");
    } catch (ex) {
      console.error("Could not delete Thunderbird filter", ex);
      button.removeAttribute("disabled");
      button.classList.remove("btn-danger");
      button.classList.add("btn-outline-danger");
      button.textContent = this.getString(
        "account.filters.delete", "Delete Thunderbird rule");
      this.setStatus(`${this.getString(
        "account.filters.delete.error", "Could not delete Thunderbird rule")}: ${ex.message || ex}`,
      "danger");
    }
  }

  /**
   * Opens Thunderbird's native editor for a source filter and refreshes the
   * generated Sieve stanza after the modal editor closes.
   *
   * @param {object} conversion
   *   converted filter with its guarded Thunderbird state.
   * @param {HTMLButtonElement} button
   *   the row's edit button.
   */
  async editSourceFilter(conversion, button) {
    button.setAttribute("disabled", "disabled");
    this.setStatus(this.getString(
      "account.filters.editing", "Opening Thunderbird's filter editor…"));

    try {
      const result = await this.account.send("account-filter-edit", {
        index: conversion.sourceIndex,
        stateToken: conversion.deleteToken
      });
      await this.render();

      if (result.changed) {
        this.setStatus(this.getString(
          "account.filters.edited",
          "Thunderbird rule changed; the Sieve block was regenerated"), "success");
      }
    } catch (ex) {
      console.error("Could not edit Thunderbird filter", ex);
      button.removeAttribute("disabled");
      this.setStatus(`${this.getString(
        "account.filters.edit.error", "Could not open Thunderbird rule")}: ${ex.message || ex}`,
      "danger");
    }
  }

  /**
   * Inserts or updates one generated block in an existing server script.
   * The background verifies that the loaded version is still current and
   * checks the complete script before overwriting it.
   *
   * @param {object} conversion
   *   converted Thunderbird filter.
   * @param {object} target
   *   selected server script and its loaded content.
   * @param {HTMLButtonElement} button
   *   clicked dropdown item.
   */
  async saveToServerScript(conversion, target, button) {
    button.setAttribute("disabled", "disabled");
    this.setStatus(this.getString(
      "account.filters.saving", "Checking and saving the Sieve script…"));

    try {
      const script = upsertFilterInScript(target.content, conversion);
      const result = await this.account.send("account-filter-script-save", {
        name: target.name,
        expected: target.content,
        script: script
      });

      await this.render();
      this.setStatus(`${this.getString(
        "account.filters.saved",
        "Block saved; the Sieve script's activation was left unchanged")}: ${result.name}.`,
      "success");
    } catch (ex) {
      console.error("Could not save Thunderbird filter to Sieve script", ex);
      if (button.isConnected)
        button.removeAttribute("disabled");
      this.setStatus(`${this.getString(
        "account.filters.save.error", "Could not save block to Sieve script")}: ${ex.message || ex}`,
      "danger");
    }
  }

  /**
   * Appends a list with source conditions or actions.
   *
   * @param {HTMLElement} parent
   *   destination cell.
   * @param {string} title
   *   list heading.
   * @param {string[]} values
   *   source descriptions.
   */
  appendSourceList(parent, title, values) {
    const heading = document.createElement("div");
    heading.className = "small fw-semibold mt-2";
    heading.textContent = title;
    parent.append(heading);

    const list = document.createElement("ul");
    list.className = "small mb-1 ps-3";
    for (const value of values.length ? values : [this.getString(
      "account.filters.none", "None")]) {
      const item = document.createElement("li");
      item.textContent = value;
      list.append(item);
    }
    parent.append(list);
  }

  /**
   * Creates one comparison row.
   *
   * @param {object} conversion
   *   converted filter.
   * @param {object[]} scripts
   *   server scripts used for implementation detection.
   * @returns {HTMLTableRowElement}
   *   the completed row.
   */
  createRow(conversion, scripts) {
    const implementations = findImplementations(conversion, scripts);
    const row = document.createElement("tr");
    if (implementations.length)
      row.classList.add("sieve-filter-implemented");

    const source = document.createElement("td");
    const title = document.createElement("div");
    title.className = "d-flex flex-wrap align-items-center gap-2";

    const name = document.createElement("strong");
    name.textContent = conversion.name;
    title.append(name);

    if (!conversion.enabled) {
      const disabled = document.createElement("span");
      disabled.className = "badge text-bg-secondary";
      disabled.textContent = this.getString("account.filters.disabled", "Disabled");
      title.append(disabled);
    }

    if (implementations.length) {
      const implemented = document.createElement("span");
      implemented.className = "badge text-bg-warning";
      implemented.textContent = this.getString(
        "account.filters.implemented", "Already found") + `: ${implementations.join(", ")}`;
      title.append(implemented);
    }

    if (Number.isInteger(conversion.sourceIndex) && conversion.deleteToken) {
      const actions = document.createElement("div");
      actions.className = "d-flex flex-wrap gap-1 ms-auto";

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn btn-sm btn-outline-secondary";
      edit.textContent = this.getString("account.filters.edit", "Edit");
      edit.addEventListener("click", async () => {
        await this.editSourceFilter(conversion, edit);
      });
      actions.append(edit);

      if (implementations.length) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn btn-sm btn-outline-danger";
        remove.textContent = this.getString(
          "account.filters.delete", "Delete Thunderbird rule");
        remove.addEventListener("click", async () => {
          await this.deleteSourceFilter(conversion, remove);
        });
        actions.append(remove);
      }

      title.append(actions);
    }

    source.append(title);
    this.appendSourceList(source, this.getString(
      "account.filters.conditions", "Conditions"), conversion.sourceConditions);
    this.appendSourceList(source, this.getString(
      "account.filters.actions", "Actions"), conversion.sourceActions);

    if (conversion.warnings.length) {
      const warnings = document.createElement("ul");
      warnings.className = "small text-danger mt-2 mb-0 ps-3";
      for (const warning of conversion.warnings) {
        const item = document.createElement("li");
        item.textContent = warning;
        warnings.append(item);
      }
      source.append(warnings);
    }

    const sieve = document.createElement("td");
    const sieveActions = document.createElement("div");
    sieveActions.className = "d-flex flex-wrap gap-1 float-end mb-2 ms-2";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "btn btn-sm btn-outline-secondary";
    copy.textContent = this.getString("account.filters.copy", "Copy stanza");
    copy.addEventListener("click", async (event) => {
      await this.copy(conversion.sieve, event.currentTarget);
    });
    sieveActions.append(copy);

    const dropdown = document.createElement("div");
    dropdown.className = "dropdown";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn btn-sm btn-outline-primary dropdown-toggle";
    save.dataset.bsToggle = "dropdown";
    save.setAttribute("aria-expanded", "false");
    save.textContent = this.getString(
      "account.filters.save", "Save to Sieve script");

    if (!this.serverConnected) {
      save.disabled = true;
      save.title = this.getString(
        "account.filters.save.offline", "Connect the server to save directly");
    } else if (!this.serverScripts.length) {
      save.disabled = true;
      save.title = this.getString(
        "account.filters.save.empty", "No existing Sieve scripts");
    }
    dropdown.append(save);

    const menu = document.createElement("ul");
    menu.className = "dropdown-menu dropdown-menu-end";
    for (const target of this.serverScripts) {
      const item = document.createElement("li");
      const select = document.createElement("button");
      select.type = "button";
      select.className = "dropdown-item";
      select.textContent = target.name;
      if (target.active) {
        select.textContent += ` (${this.getString(
          "account.filters.save.active", "active")})`;
      }
      select.addEventListener("click", async () => {
        await this.saveToServerScript(conversion, target, select);
      });
      item.append(select);
      menu.append(item);
    }
    dropdown.append(menu);
    sieveActions.append(dropdown);
    sieve.append(sieveActions);

    const pre = document.createElement("pre");
    pre.className = "sieve-filter-code mb-0";
    const code = document.createElement("code");
    code.textContent = conversion.sieve;
    pre.append(code);
    sieve.append(pre);

    row.append(source, sieve);
    return row;
  }

  /**
   * Loads Thunderbird rules and refreshes the table.
   */
  async render() {
    if (this.rendering)
      return;

    this.rendering = true;
    const refresh = this.root.querySelector(".sieve-filters-refresh");
    const copyAll = this.root.querySelector(".sieve-filters-copy-all");
    refresh.disabled = true;
    copyAll.disabled = true;
    this.setStatus(this.getString("account.filters.loading", "Loading Thunderbird filters…"));

    try {
      const [filters, comparison] = await Promise.all([
        this.account.send("account-filters-list"),
        this.account.send("account-filter-scripts")
      ]);
      this.conversions = (filters || []).map((filter) => { return convertFilter(filter); });
      this.serverScripts = comparison.scripts || [];
      this.serverConnected = !!comparison.connected;

      const rows = this.root.querySelector(".sieve-filters-rows");
      while (rows.firstChild)
        rows.firstChild.remove();

      for (const conversion of this.conversions)
        rows.append(this.createRow(conversion, this.serverScripts));

      this.root.querySelector(".sieve-filters-table-wrap")
        .classList.toggle("d-none", !this.conversions.length);
      copyAll.disabled = !this.conversions.length;

      if (!this.conversions.length) {
        this.setStatus(this.getString(
          "account.filters.empty", "No Thunderbird filters were found for this server."), "info");
      } else if (!comparison.connected) {
        this.setStatus(this.getString(
          "account.filters.offline",
          "Rules are ready. Connect this server to highlight filters already found in its Sieve scripts."),
        "info");
      } else {
        const implemented = this.conversions.filter((conversion) => {
          return findImplementations(conversion, comparison.scripts || []).length;
        }).length;
        this.setStatus(`${this.conversions.length} ${this.getString(
          "account.filters.loaded", "Thunderbird filters loaded")}; ${implemented} ${this.getString(
          "account.filters.found", "already found on the server")}.`, "success");
      }
    } catch (ex) {
      console.error("Could not render Thunderbird filters", ex);
      this.setStatus(
        `${this.getString("account.filters.error", "Could not read Thunderbird filters")}: ${ex.message || ex}`,
        "danger");
    } finally {
      refresh.disabled = false;
      this.rendering = false;
    }
  }
}

export { SieveFilterImportUI };
