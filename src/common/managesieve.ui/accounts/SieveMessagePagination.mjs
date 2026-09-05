/*
 * Shared client-side pagination for the Inbox and Spam message tables.
 */

const MESSAGE_PAGE_SIZES = [10, 20, 50, 100];
const DEFAULT_MESSAGE_PAGE_SIZE = 20;

/**
 * Builds one stable page without changing the complete source array.
 *
 * @param {object[]} messages
 *   the complete, already filtered message list.
 * @param {number} requestedPage
 *   requested one-based page number.
 * @param {number} requestedPageSize
 *   requested number of rows per page.
 * @returns {object}
 *   normalized page model and its sliced items.
 */
function createMessagePage(messages, requestedPage, requestedPageSize) {
  messages = Array.isArray(messages) ? messages : [];
  const pageSize = MESSAGE_PAGE_SIZES.includes(Number(requestedPageSize))
    ? Number(requestedPageSize) : DEFAULT_MESSAGE_PAGE_SIZE;
  const totalItems = messages.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(totalPages, Math.max(1,
    Number.parseInt(requestedPage, 10) || 1));
  const offset = (page - 1) * pageSize;

  return {
    items: messages.slice(offset, offset + pageSize),
    page,
    pageSize,
    totalItems,
    totalPages,
    start: totalItems ? offset + 1 : 0,
    end: Math.min(totalItems, offset + pageSize)
  };
}

/**
 * Returns compact numbered controls with null entries representing ellipses.
 *
 * @param {number} page
 *   active one-based page.
 * @param {number} totalPages
 *   total number of pages.
 * @returns {(number|null)[]}
 *   ordered page numbers and ellipses.
 */
function createPageTokens(page, totalPages) {
  if (totalPages <= 7)
    return Array.from({ length: totalPages }, (_value, index) => { return index + 1; });

  const numbers = [...new Set([
    1,
    totalPages,
    page - 2,
    page - 1,
    page,
    page + 1,
    page + 2
  ].filter((value) => { return value >= 1 && value <= totalPages; }))]
    .sort((left, right) => { return left - right; });
  const tokens = [];
  for (const number of numbers) {
    if (tokens.length && number - tokens.at(-1) > 1)
      tokens.push(null);
    tokens.push(number);
  }
  return tokens;
}

/**
 * Controls one message table's page size and navigation buttons.
 */
class SieveMessagePagination {

  /**
   * @param {HTMLElement} root
   *   owning Inbox or Spam pane.
   * @param {string} prefix
   *   CSS class prefix such as sieve-inbox.
   * @param {Function} getString
   *   localization callback.
   * @param {Function} onChange
   *   redraw callback after a user changes the page.
   */
  constructor(root, prefix, getString, onChange) {
    this.root = root;
    this.prefix = prefix;
    this.getString = getString;
    this.onChange = onChange;
    this.page = 1;
    this.pageSize = DEFAULT_MESSAGE_PAGE_SIZE;
    this.container = root.querySelector(`.${prefix}-pagination`);
    this.buttons = root.querySelector(`.${prefix}-page-buttons`);
    this.select = root.querySelector(`.${prefix}-page-size`);

    root.querySelector(`.${prefix}-page-size-label`).textContent = getString(
      "account.messages.page.size", "Messages per page");
    this.select.value = `${this.pageSize}`;
    this.select.addEventListener("change", () => {
      this.pageSize = MESSAGE_PAGE_SIZES.includes(Number(this.select.value))
        ? Number(this.select.value) : DEFAULT_MESSAGE_PAGE_SIZE;
      this.page = 1;
      this.onChange();
    });
  }

  /** Reset navigation to the first page. */
  reset() {
    this.page = 1;
  }

  /**
   * Slices and renders one page of the already filtered messages.
   *
   * @param {object[]} messages
   *   complete search result.
   * @returns {object}
   *   normalized page model.
   */
  paginate(messages) {
    const model = createMessagePage(messages, this.page, this.pageSize);
    this.page = model.page;
    this.pageSize = model.pageSize;
    this.render(model);
    return model;
  }

  /**
   * Draws first, previous, numbered, next and last controls.
   *
   * @param {object} model
   *   normalized page model.
   */
  render(model) {
    this.container.classList.toggle("d-none", model.totalItems === 0);
    this.buttons.replaceChildren();
    if (!model.totalItems)
      return;

    const appendButton = (label, target, title, disabled = false, active = false) => {
      const button = this.root.ownerDocument.createElement("button");
      button.type = "button";
      button.className = `btn btn-sm ${active ? "btn-primary" : "btn-outline-secondary"}`;
      button.textContent = label;
      button.title = title;
      button.ariaLabel = title;
      button.disabled = disabled;
      if (active)
        button.setAttribute("aria-current", "page");
      button.addEventListener("click", () => {
        this.page = target;
        this.onChange();
      });
      this.buttons.append(button);
    };
    const pageTitle = this.getString("account.messages.page", "Page");
    appendButton("<<", 1, this.getString(
      "account.messages.page.first", "First page"), model.page === 1);
    appendButton("<", model.page - 1, this.getString(
      "account.messages.page.previous", "Previous page"), model.page === 1);

    for (const token of createPageTokens(model.page, model.totalPages)) {
      if (token === null) {
        const ellipsis = this.root.ownerDocument.createElement("span");
        ellipsis.className = "btn btn-sm disabled border-0";
        ellipsis.textContent = "…";
        this.buttons.append(ellipsis);
        continue;
      }
      appendButton(`${token}`, token, `${pageTitle} ${token}`, false, token === model.page);
    }

    appendButton(">", model.page + 1, this.getString(
      "account.messages.page.next", "Next page"), model.page === model.totalPages);
    appendButton(">>", model.totalPages, this.getString(
      "account.messages.page.last", "Last page"), model.page === model.totalPages);
  }
}

export {
  createMessagePage,
  createPageTokens,
  DEFAULT_MESSAGE_PAGE_SIZE,
  MESSAGE_PAGE_SIZES,
  SieveMessagePagination
};
