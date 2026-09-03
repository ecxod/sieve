/*
 * Stable, locale-aware ordering for account cards on the Home page.
 */

/**
 * Sorts account descriptors by their visible display name.
 *
 * @param {{id: string, displayName: string}[]} entries
 *   account descriptors.
 * @param {string|string[]} [locales]
 *   optional locale override used by tests.
 * @returns {{id: string, displayName: string}[]}
 *   sorted copy.
 */
function sortAccountsByDisplayName(entries, locales) {
  const collator = new Intl.Collator(locales, {
    numeric: true,
    sensitivity: "base"
  });

  return [...entries].sort((left, right) => {
    const byName = collator.compare(
      `${left.displayName || ""}`.trim(), `${right.displayName || ""}`.trim());
    if (byName)
      return byName;

    return `${left.id || ""}`.localeCompare(`${right.id || ""}`);
  });
}

export { sortAccountsByDisplayName };
