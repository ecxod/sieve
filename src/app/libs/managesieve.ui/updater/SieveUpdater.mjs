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


const SIEVE_GITHUB_RELEASE_API = "https://api.github.com/repos/ecxod/sieve/releases/latest";
const SIEVE_GITHUB_RELEASE_URL = "https://github.com/ecxod/sieve/releases/latest";
const MAX_INSTALLER_SIZE = 512 * 1024 * 1024;

/**
 * Checks for Updates on github.
 */
class SieveUpdater {

  /**
   * Normalizes a GitHub release tag to an application version.
   *
   * @param {string} tag
   *   release tag such as v0.8.0.
   * @returns {string|null}
   *   normalized numeric version or null for an invalid tag.
   */
  normalizeVersion(tag) {
    const version = `${tag || ""}`.trim().replace(/^v/iu, "");

    if (!/^\d+(?:\.\d+){1,3}$/u.test(version))
      return null;

    return version;
  }

  /**
   * Validates installer metadata before it reaches the privileged downloader.
   *
   * @param {object} installer
   *   installer metadata obtained from a GitHub release.
   * @returns {object}
   *   normalized installer metadata.
   */
  validateInstaller(installer) {
    if (!installer || typeof installer !== "object")
      throw new Error("Invalid update installer metadata");

    const version = this.normalizeVersion(installer.version);
    if (version === null)
      throw new Error("Invalid update installer version");

    const name = `install_sieve_${version}.exe`;
    if (installer.name !== name)
      throw new Error("Unexpected update installer name");

    const url = new URL(installer.url);
    const expectedPath = `/ecxod/sieve/releases/download/v${version}/${name}`;
    if (url.protocol !== "https:"
      || url.hostname !== "github.com"
      || url.pathname !== expectedPath
      || url.username !== ""
      || url.password !== ""
      || url.search !== ""
      || url.hash !== "")
      throw new Error("Unexpected update installer URL");

    const size = Number.parseInt(installer.size, 10);
    if (!Number.isInteger(size) || size < 1 || size > MAX_INSTALLER_SIZE)
      throw new Error("Invalid update installer size");

    const digest = `${installer.digest || ""}`.toLowerCase();
    if (!/^sha256:[a-f0-9]{64}$/u.test(digest))
      throw new Error("A valid SHA-256 installer digest is required");

    return {
      version,
      name,
      url: url.toString(),
      size,
      digest
    };
  }

  /**
   * Builds the user-visible update status from a GitHub release.
   *
   * @param {object} release
   *   GitHub latest-release response.
   * @param {string} currentVersion
   *   installed application version.
   * @param {string} platform
   *   Node platform name.
   * @returns {object}
   *   normalized update status.
   */
  createStatus(release, currentVersion, platform) {
    const latestVersion = this.normalizeVersion(release?.tag_name);
    if (latestVersion === null)
      throw new Error("GitHub returned an invalid release version");

    const installedVersion = this.normalizeVersion(currentVersion);
    if (installedVersion === null)
      throw new Error("The installed application version is invalid");

    const expectedName = `install_sieve_${latestVersion}.exe`;
    const asset = Array.isArray(release.assets)
      ? release.assets.find((item) => {
        return item?.state === "uploaded" && item.name === expectedName;
      })
      : null;
    let installer = null;

    if (asset) {
      try {
        installer = this.validateInstaller({
          version: latestVersion,
          name: asset.name,
          url: asset.browser_download_url,
          size: asset.size,
          digest: asset.digest
        });
      } catch {
        installer = null;
      }
    }

    const updateAvailable = !this.isOlder(latestVersion, installedVersion);
    const releaseUrl = release.html_url ===
      `https://github.com/ecxod/sieve/releases/tag/v${latestVersion}`
      ? release.html_url
      : SIEVE_GITHUB_RELEASE_URL;

    return {
      currentVersion: installedVersion,
      latestVersion,
      platform,
      updateAvailable,
      installSupported: updateAvailable && platform === "win32" && installer !== null,
      installer,
      releaseUrl,
      publishedAt: typeof release.published_at === "string" ? release.published_at : null
    };
  }

  /**
   * Loads the latest published GitHub release.
   *
   * @returns {object}
   *   GitHub release data.
   */
  async fetchLatestRelease() {
    const response = await fetch(SIEVE_GITHUB_RELEASE_API, {
      cache: "no-store",
      headers: {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });

    if (!response.ok)
      throw new Error(`GitHub update request failed with HTTP ${response.status}`);

    return await response.json();
  }

  /**
   * Converts the given string into an integer
   * @param {string} version
   *   the version number as string which should be converted to integer.
   * @returns {Integer|NaN}
   *   returns the integer value or NaN in case the string is no integer.
   */
  getInt(version) {
    const value = Number.parseInt(version, 10);

    if (Number.isInteger(value))
      return value;

    return Number.NaN;
  }


  /**
   * Checks if the current version is less than the new version.
   *
   * For comparison the string values are converted to an integer.
   * In case no integer comparison is possible a string comparison will be performed.
   *
   * @param {string} newVersion
   *   the new version as string
   * @param {string} currentVersion
   *   the current version as string
   *
   * @returns {boolean}
   *    false in case the current version is the latest
   *    true in case there is a newer version
   */
  isLessThan(newVersion, currentVersion) {

    const newValue = this.getInt(newVersion);
    const currentValue = this.getInt(currentVersion);

    // in case conversion failed we use string comparison
    if (isNaN(newValue) || isNaN(currentValue))
      return (newVersion < currentVersion);

    return newValue < currentValue;
  }

  /**
   * Checks if the current version is greater than the new version.
   *
   * For comparison the string values are converted to an integer.
   * In case no integer comparison is possible a string comparison will be performed.
   *
   * @param {string} newVersion
   *   the new version as string
   * @param {string} currentVersion
   *   the current version as string
   *
   * @returns {boolean}
   *    true in case the new version is larger than the current
   *    false in the new version is smaller than the current.
   */
  isGreaterThan(newVersion, currentVersion) {
    const newValue = this.getInt(newVersion);
    const currentValue = this.getInt(currentVersion);

    // in case conversion failed we use string comparison
    if (isNaN(newValue) || isNaN(currentValue))
      return (newVersion > currentVersion);

    return newValue > currentValue;
  }

  /**
   * Compares if the next version is older than the current version.
   *
   * @param {string} next
   *   the next version as dot separated string.
   * @param {string} current
   *   the current version as dot separated string.
   * @returns {boolean}
   *   true in case the current version is older than the next version otherwise false.
   */
  isOlder(next, current) {
    current = current.split(".");
    next = next.split(".");
    const length = Math.max(current.length, next.length);

    for (let idx = 0; idx < length; idx++) {
      const nextComponent = next[idx] ?? "0";
      const currentComponent = current[idx] ?? "0";

      if (this.isGreaterThan(nextComponent, currentComponent))
        return false;

      if (this.isLessThan(nextComponent, currentComponent))
        return true;
    }

    // Otherwise in case it is less or equal, the version is older or the same.
    return true;
  }

  /**
   * Compares the current version against the manifest.
   * @param {object} manifest
   *   the manifest with the version information
   * @param {string} currentVersion
   *   the apps current version.
   * @returns {boolean}
   *   false if the current version is the latest.
   *   true in case the manifest contains a newer version definition.
   */
  compare(manifest, currentVersion) {
    const items = manifest["addons"]["sieve-cram-md5@ecxod.github.io"]["updates"];

    // There are no updates if all entries are less or equal to the current version
    for (const item of items) {

      if (this.isOlder(item.version, currentVersion))
        continue;

      return true;
    }

    return false;
  }

  /**
   * Checks the if any updates are published at github.
   * @returns {boolean}
   *  true if newer version are available, otherwise false.
   */
  async check() {
    return (await this.getStatus()).updateAvailable;
  }

  /**
   * Gets the installed and latest-release versions plus installer metadata.
   *
   * @returns {object}
   *   normalized update status.
   */
  async getStatus() {
    const currentVersion = await require('electron').ipcRenderer.invoke("get-version");

    return this.createStatus(
      await this.fetchLatestRelease(), currentVersion, process.platform);
  }
}

export { SieveUpdater };
