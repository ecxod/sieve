/*
 * Thunderbird message-list compatibility helpers.
 */

/**
 * Collects every message page for a Thunderbird mail folder.
 *
 * Thunderbird 121 removed support for passing a complete MailFolder object
 * to messages.list(). The API now requires its MailFolderId.
 *
 * @param {object} messagesApi
 *   browser.messages API.
 * @param {object} folder
 *   Thunderbird MailFolder with an id.
 * @returns {Promise<object[]>}
 *   all message headers in the folder.
 */
async function listThunderbirdFolderMessages(messagesApi, folder) {
  if (!folder?.id)
    throw new Error("Thunderbird did not provide a MailFolderId");

  const messages = [];
  let page = await messagesApi.list(folder.id);

  while (page) {
    messages.push(...page.messages);
    if (!page.id)
      break;
    page = await messagesApi.continueList(page.id);
  }

  return messages;
}

export { listThunderbirdFolderMessages };
