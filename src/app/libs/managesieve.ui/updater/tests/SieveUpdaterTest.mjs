/*
 * The contents of this file are licensed. You may obtain a copy of
 * the license at https://github.com/thsmi/sieve/ or request it via
 * email from the author.
 *
 * Do not remove or change this comment.
 *
 * The initial author of the code is:
 *   Thomas Schmid <schmid-thomas@gmx.net>
 *
 */

/* global net */
const suite = net.tschmid.yautt.test;

if (!suite)
  throw new Error("Could not initialize test suite");

import { SieveUpdater } from "./../SieveUpdater.mjs";

const NUMBER_SIX = 6;
const TEST_DIGEST = `sha256:${"a".repeat(64)}`;

/**
 * Creates GitHub release data for update-status tests.
 *
 * @param {string} version
 *   release version.
 * @returns {object}
 *   release response fixture.
 */
function createRelease(version) {
  return {
    "tag_name": `v${version}`,
    "html_url": `https://github.com/ecxod/sieve/releases/tag/v${version}`,
    "published_at": "2026-08-26T12:00:00Z",
    assets: [{
      state: "uploaded",
      name: `install_sieve_${version}.exe`,
      "browser_download_url":
        `https://github.com/ecxod/sieve/releases/download/v${version}/install_sieve_${version}.exe`,
      size: 123456,
      digest: TEST_DIGEST
    }]
  };
}

suite.add("Major Version Bump", function () {
  suite.assertFalse((new SieveUpdater()).isOlder("6", "5.5.4"));
  suite.assertFalse((new SieveUpdater()).isOlder("6.5", "5.5.4"));
  suite.assertFalse((new SieveUpdater()).isOlder("6.5.4", "5.5.4"));

  suite.assertTrue((new SieveUpdater()).isOlder("6.5.4", "7.5.4"));

  suite.assertTrue((new SieveUpdater()).isOlder("6.5.4", "a.b.c"));
  suite.assertFalse((new SieveUpdater()).isOlder("a.b.c", "6.5.4"));
});

suite.add("Minor Version Bump", function () {
  suite.assertFalse((new SieveUpdater()).isOlder("6.5", "6.4.4"));
  suite.assertFalse((new SieveUpdater()).isOlder("6.5.4", "6.4.4"));
  suite.assertTrue((new SieveUpdater()).isOlder("6.5.4", "6.6.4"));

  suite.assertTrue((new SieveUpdater()).isOlder("6.5.4", "6.b.c"));
  suite.assertFalse((new SieveUpdater()).isOlder("6.b.c", "6.5.4"));
});

suite.add("Patch Version Bump", function () {
  suite.assertFalse((new SieveUpdater()).isOlder("6.5.4", "6.5.3"));
  suite.assertTrue((new SieveUpdater()).isOlder("6.5.4", "6.5.5"));

  suite.assertTrue((new SieveUpdater()).isOlder("6.5.4", "6.5.c"));
  suite.assertFalse((new SieveUpdater()).isOlder("6.5.c", "6.5.4"));
});

suite.add("Build Version Bump", function () {
  suite.assertFalse((new SieveUpdater()).isOlder("0.6.1.1", "0.6.1"));
  suite.assertFalse((new SieveUpdater()).isOlder("0.6.1.2", "0.6.1.1"));
  suite.assertTrue((new SieveUpdater()).isOlder("0.6.1.1", "0.6.1.2"));
});

suite.add("No Version Bump", function () {
  suite.assertTrue((new SieveUpdater()).isOlder("6.5.4", "6.5.4"));
});


suite.add("Manifest - Does not contain any versions", function () {
  const manifest = {
    "addons": {
      "sieve-cram-md5@ecxod.github.io": {
        "updates": []
      }
    }
  };

  suite.assertFalse((new SieveUpdater()).compare(manifest, "6.5.4"));
});

suite.add("Manifest - Has newer version", function () {
  const manifest = {
    "addons": {
      "sieve-cram-md5@ecxod.github.io": {
        "updates": [
          { "version": "5.6.7" },
          { "version": "1.2.3" },
          { "version": "2.3.4" }
        ]
      }
    }
  };

  suite.assertTrue((new SieveUpdater()).compare(manifest, "4.5.6"));
});

suite.add("Manifest - Same version", function () {
  const manifest = {
    "addons": {
      "sieve-cram-md5@ecxod.github.io": {
        "updates": [
          { "version": "5.6.7" },
          { "version": "1.2.3" },
          { "version": "2.3.4" }
        ]
      }
    }
  };

  suite.assertFalse((new SieveUpdater()).compare(manifest, "5.6.7"));
});

suite.add("Manifest - Has newer build version", function () {
  const manifest = {
    "addons": {
      "sieve-cram-md5@ecxod.github.io": {
        "updates": [
          { "version": "0.6.1.9" }
        ]
      }
    }
  };

  suite.assertTrue((new SieveUpdater()).compare(manifest, "0.6.1"));
  suite.assertFalse((new SieveUpdater()).compare(manifest, "0.6.1.9"));
});

suite.add("Manifest - Only older versions", function () {
  const manifest = {
    "addons": {
      "sieve-cram-md5@ecxod.github.io": {
        "updates": [
          { "version": "5.6.7" },
          { "version": "1.2.3" },
          { "version": "2.3.4" }
        ]
      }
    }
  };

  suite.assertFalse((new SieveUpdater()).compare(manifest, "5.6.8"));
});

suite.add("GitHub release exposes a verified Windows installer", function () {
  const status = (new SieveUpdater()).createStatus(
    createRelease("0.8.7"), "0.8.6", "win32");

  suite.assertTrue(status.updateAvailable);
  suite.assertTrue(status.installSupported);
  suite.assertEquals(status.currentVersion, "0.8.6");
  suite.assertEquals(status.latestVersion, "0.8.7");
  suite.assertEquals(status.installer.name, "install_sieve_0.8.7.exe");
  suite.assertEquals(status.installer.digest, TEST_DIGEST);
});

suite.add("GitHub release does not downgrade or auto-install on Linux", function () {
  const updater = new SieveUpdater();
  const current = updater.createStatus(createRelease("0.8.6"), "0.8.6", "win32");
  const older = updater.createStatus(createRelease("0.8.5"), "0.8.6", "win32");
  const linux = updater.createStatus(createRelease("0.8.7"), "0.8.6", "linux");

  suite.assertFalse(current.updateAvailable);
  suite.assertFalse(older.updateAvailable);
  suite.assertTrue(linux.updateAvailable);
  suite.assertFalse(linux.installSupported);
});

suite.add("GitHub release requires trusted installer metadata", function () {
  const updater = new SieveUpdater();
  const release = createRelease("0.8.7");

  release.assets[0].digest = null;
  const status = updater.createStatus(release, "0.8.6", "win32");

  suite.assertTrue(status.updateAvailable);
  suite.assertFalse(status.installSupported);
  suite.assertEquals(status.installer, null);

  suite.assertThrows(() => {
    updater.validateInstaller({
      version: "0.8.7",
      name: "install_sieve_0.8.7.exe",
      url: "https://example.com/install_sieve_0.8.7.exe",
      size: 123456,
      digest: TEST_DIGEST
    });
  }, "Unexpected update installer URL");
});

suite.add("Comparator - greater than", function () {
  // Numeric comparison
  suite.assertTrue((new SieveUpdater()).isGreaterThan("6", "5"));
  suite.assertFalse((new SieveUpdater()).isGreaterThan("6", "6"));
  suite.assertFalse((new SieveUpdater()).isGreaterThan("6", "7"));

  // String Comparison in Unicode order
  suite.assertTrue((new SieveUpdater()).isGreaterThan("B", "A"));
  suite.assertTrue((new SieveUpdater()).isGreaterThan("AA", "A"));
  suite.assertFalse((new SieveUpdater()).isGreaterThan("A", "A"));
});

suite.add("Comparator - smaller than", function () {
  // Numeric comparison
  suite.assertTrue((new SieveUpdater()).isLessThan("6", "7"));
  suite.assertFalse((new SieveUpdater()).isLessThan("6", "6"));
  suite.assertFalse((new SieveUpdater()).isLessThan("6", "5"));

  // String Comparison in Unicode order
  suite.assertTrue((new SieveUpdater()).isLessThan("A", "B"));
  suite.assertTrue((new SieveUpdater()).isLessThan("A", "AA"));
  suite.assertFalse((new SieveUpdater()).isLessThan("A", "A"));
});

suite.add("Int conversion", function () {
  suite.assertEquals((new SieveUpdater()).getInt("6"), NUMBER_SIX);
  suite.assertEquals((new SieveUpdater()).getInt("6.5"), NUMBER_SIX);
  suite.assertEquals((new SieveUpdater()).getInt("6,5"), NUMBER_SIX);
  suite.assertNaN((new SieveUpdater()).getInt("A"));
});
