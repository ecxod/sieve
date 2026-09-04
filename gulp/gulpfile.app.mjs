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

import gulp from 'gulp';
import logger from 'gulplog';

import { existsSync } from 'fs';
import { chmod, cp, mkdir, rm, symlink, unlink, writeFile } from 'fs/promises';

import { promisify } from 'util';
import { exec } from 'child_process';

import common from "./gulpfile.common.mjs";
import https from "./gulpfile.common.https.mjs";

import path from 'path';


import packager from '@electron/packager';


const CACHE_DIR_APP = path.join(common.BASE_DIR_BUILD, "electron/cache");
const BUILD_DIR_APP = path.join(common.BASE_DIR_BUILD, "electron/resources");
const OUTPUT_DIR_APP = path.join(common.BASE_DIR_BUILD, "electron/out");
const BASE_DIR_APP = "./src/app/";

const BUILD_DIR_APP_LIBS = path.join(BUILD_DIR_APP, '/libs');

const WIN_ARCH = "x64";
const WIN_PLATFORM = "win32";
const LINUX_ARCH = "x64";
const LINUX_PLATFORM = "linux";
const MAC_ARCH = "x64";
const MAC_PLATFORM = "mas";

const APP_IMAGE_RELEASE_URL = "https://api.github.com/repos/AppImage/appimagetool/releases";
const APP_IMAGE_TOOL_NAME = "appimagetool-x86_64.AppImage";
const APP_IMAGE_DIR = path.join(OUTPUT_DIR_APP, "sieve.AppDir");
const DEBIAN_PACKAGE_NAME = "sieve-cram-md5";
const DEBIAN_PACKAGE_DIR = path.join(OUTPUT_DIR_APP, "sieve-debian-amd64");

const OUTPUT_DIR_APP_WIN32 = path.join(OUTPUT_DIR_APP, `sieve-${WIN_PLATFORM}-${WIN_ARCH}`);
const OUTPUT_DIR_APP_LINUX = path.join(OUTPUT_DIR_APP, `sieve-${LINUX_PLATFORM}-${LINUX_ARCH}`);
const OUTPUT_DIR_APP_MACOS = path.join(OUTPUT_DIR_APP, `sieve-${MAC_PLATFORM}-${MAC_ARCH}`);

const PERMISSIONS_EXECUTABLE = 0o100770;
const PERMISSIONS_NORMAL = 0o100660;


/**
 * Copies the package definition and lock file into the build directory.
 * It is typically used by other tools like the electron-packager.
 *
 * @returns {Stream}
 *   a stream to be consumed by gulp
 */
function packageDefinition() {

  const BASE_PATH = ".";

  return gulp.src([
    BASE_PATH + "/package.json",
    BASE_PATH + "/package-lock.json"
  ], { base: BASE_PATH }).pipe(gulp.dest(BUILD_DIR_APP));
}

/**
 * Installs only locked production dependencies into the packaged app.
 */
async function packageDependencies() {
  await promisify(exec)(
    "npm ci --omit=dev --ignore-scripts --no-audit --no-fund",
    { cwd: BUILD_DIR_APP });

  await unlink(path.join(BUILD_DIR_APP, "package-lock.json"));
}

/**
 * Copies the license file into the build directory.
 *
 * @returns {Stream}
 *   a stream to be consumed by gulp
 */
function packageLicense() {

  return gulp.src([
    "./LICENSE.md"
  ]).pipe(gulp.dest(BUILD_DIR_APP));
}

/**
 * Copies the codemirror sources into the build directory.
 *
 * @returns {Stream}
 *   a stream to be consumed by gulp
 */
function packageCodeMirror() {
  return common.packageCodeMirror(
    `${BUILD_DIR_APP}/libs/CodeMirror`);
}

/**
 * Copies the bootstrap sources into the build directory.
 *
 * @returns {Stream}
 *   a stream to be consumed by gulp
 **/
function packageBootstrap() {

  return common.packageBootstrap(
    `${BUILD_DIR_APP}/libs/bootstrap`);
}

/**
 * Copies the source files into the app/ directory...
 *
 * @returns {Stream}
 *   a stream to be consumed by gulp
 */
function packageSrc() {
  return gulp.src([
    BASE_DIR_APP + "/**",
    `!${BASE_DIR_APP}/libs/libManageSieve/**`
  ], { encoding: false} ).pipe(gulp.dest(BUILD_DIR_APP));
}

/**
 * Copies the application's icons into the lib folder.
 * We use it internally for windows decoration.
 *
 * @returns {Stream}
 *   a stream to be consumed by gulp
 */
function packageIcons() {

  return gulp.src([
    path.join(common.BASE_DIR_COMMON, "icons") + "/**"
  ], { base: common.BASE_DIR_COMMON, encoding: false }).pipe(gulp.dest(BUILD_DIR_APP_LIBS));
}

/**
 * Copies the common libManageSieve files into the app's lib folder
 *
 * @returns {Stream}
 *   a stream to be consumed by gulp
 */
function packageLibManageSieve() {

  const BASE_APP = path.join(BASE_DIR_APP, "libs", "libManageSieve");
  const BASE_COMMON = path.join(common.BASE_DIR_COMMON, "libManageSieve");

  return common.src2(BASE_APP)
    .pipe(common.src2(BASE_COMMON))
    .pipe(gulp.dest(path.join(BUILD_DIR_APP_LIBS, "libManageSieve")));
}


/**
 * Copies the common libSieve files into the app's lib folder
 *
 * @returns {Stream}
 *   a stream to be consumed by gulp
 */
function packageLibSieve() {
  return common.packageLibSieve(BUILD_DIR_APP_LIBS);
}


/**
 * Copies the common managesieve.ui files into the app's lib folder
 *
 * @returns {Stream}
 *   a stream to be consumed by gulp
 */
function packageManageSieveUi() {
  return common.packageManageSieveUi(BUILD_DIR_APP_LIBS);
}

/**
 * Reuses the protocol-neutral spam tab UI in the standalone application.
 * The actual mail operations are supplied by the Electron IMAP adapter.
 *
 * @returns {Stream}
 *   a stream to be consumed by gulp.
 */
function packageSpamUi() {
  const base = path.join("./src/wx/libs", "managesieve.ui");

  return gulp.src([
    path.join(base, "accounts.css"),
    path.join(base, "accounts", "SieveSpamUI.mjs"),
    path.join(base, "accounts", "SieveSpamContextUI.mjs"),
    path.join(base, "accounts", "account.spam.html")
  ], { base: base, encoding: false })
    .pipe(gulp.dest(path.join(BUILD_DIR_APP_LIBS, "managesieve.ui")));
}

/**
 * Packages the build directory and electron for windows.
 */
async function packageWin32() {

  const options = {
    dir: BUILD_DIR_APP,
    arch: WIN_ARCH,
    platform: WIN_PLATFORM,
    download: {
      cacheRoot: CACHE_DIR_APP
    },
    out: OUTPUT_DIR_APP,
    overwrite: true,
    icon: path.join(common.BASE_DIR_COMMON, "icons/win.ico")
  };

  await packager(options);
}

/**
 * Packages the build directory and electron for linux
 */
async function packageLinux() {

  const options = {
    dir: BUILD_DIR_APP,
    arch: LINUX_ARCH,
    platform: LINUX_PLATFORM,
    download: {
      cacheRoot: CACHE_DIR_APP
    },
    out: OUTPUT_DIR_APP,
    overwrite: true,
    prune: true
  };

  await packager(options);
}

/**
 * Packages the Linux Electron application as a Debian archive.
 *
 * The package contains only static files and deliberately has no maintainer
 * scripts or systemd dependency, so it is suitable for Debian and Devuan.
 */
async function packageDebian() {
  const version = (await common.getPackageVersion()).join(".");
  const destination = path.resolve(path.join(
    common.BASE_DIR_BUILD, `sieve-${version}-linux-amd64.deb`));
  const appDir = path.join(DEBIAN_PACKAGE_DIR, "opt", DEBIAN_PACKAGE_NAME);
  const binDir = path.join(DEBIAN_PACKAGE_DIR, "usr", "bin");
  const desktopDir = path.join(
    DEBIAN_PACKAGE_DIR, "usr", "share", "applications");
  const iconDir = path.join(
    DEBIAN_PACKAGE_DIR, "usr", "share", "icons", "hicolor", "64x64", "apps");
  const documentationDir = path.join(
    DEBIAN_PACKAGE_DIR, "usr", "share", "doc", DEBIAN_PACKAGE_NAME);

  await rm(DEBIAN_PACKAGE_DIR, { recursive: true, force: true });
  await unlink(destination).catch((ex) => {
    if (ex.code !== "ENOENT")
      throw ex;
  });

  await mkdir(path.join(DEBIAN_PACKAGE_DIR, "DEBIAN"), { recursive: true });
  await mkdir(binDir, { recursive: true });
  await mkdir(desktopDir, { recursive: true });
  await mkdir(iconDir, { recursive: true });
  await mkdir(documentationDir, { recursive: true });
  await cp(OUTPUT_DIR_APP_LINUX, appDir, { recursive: true });
  await chmod(appDir, 0o755);
  await symlink(
    `../../opt/${DEBIAN_PACKAGE_NAME}/sieve`,
    path.join(binDir, DEBIAN_PACKAGE_NAME));
  await cp(
    path.join(common.BASE_DIR_COMMON, "icons", "linux.png"),
    path.join(iconDir, `${DEBIAN_PACKAGE_NAME}.png`));
  await cp(
    "./LICENSE.md",
    path.join(documentationDir, "copyright"));
  await chmod(path.join(documentationDir, "copyright"), 0o644);

  await writeFile(path.join(desktopDir, `${DEBIAN_PACKAGE_NAME}.desktop`),
    `[Desktop Entry]\n`
    + `Name=Sieve CRAM-MD5\n`
    + `Comment=Manage server-side Sieve mail filters\n`
    + `Exec=${DEBIAN_PACKAGE_NAME}\n`
    + `Icon=${DEBIAN_PACKAGE_NAME}\n`
    + `Terminal=false\n`
    + `Type=Application\n`
    + `Categories=Network;Email;Utility;\n`
    + `StartupWMClass=sieve\n`, "utf8");

  await writeFile(path.join(DEBIAN_PACKAGE_DIR, "DEBIAN", "control"),
    `Package: ${DEBIAN_PACKAGE_NAME}\n`
    + `Version: ${version}\n`
    + `Section: mail\n`
    + `Priority: optional\n`
    + `Architecture: amd64\n`
    + `Maintainer: ecxod\n`
    + `Homepage: https://github.com/ecxod/sieve\n`
    + `Depends: libasound2, libatk-bridge2.0-0, libc6, libcairo2, libcups2, `
    + `libdbus-1-3, libdrm2, libexpat1, libgbm1, libglib2.0-0, libgtk-3-0, `
    + `libnspr4, libnss3, libpango-1.0-0, libsecret-1-0, libx11-6, `
    + `libx11-xcb1, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, `
    + `libxkbcommon0, libxrandr2, xdg-utils\n`
    + `Description: graphical ManageSieve editor with CRAM-MD5 support\n`
    + ` Edit server-side Sieve mail-filter scripts in a standalone desktop app.\n`,
    "utf8");

  await promisify(exec)(
    `dpkg-deb --root-owner-group --build "${DEBIAN_PACKAGE_DIR}" "${destination}"`);
}

/**
 * Packages the build directory and electron for macOS
 */
async function packageMacOS() {

  const options = {
    dir: BUILD_DIR_APP,
    arch: MAC_ARCH,
    platform: MAC_PLATFORM,
    download: {
      cacheRoot: CACHE_DIR_APP
    },
    out: OUTPUT_DIR_APP,
    overwrite: true,
    icon: path.join(common.BASE_DIR_COMMON, "icons/mac.icns"),
    prune: true
    // app-bundle-id: "net.tschmid.sieve"
  };

  await packager(options);
}

/**
 * Updates the addons version.
 */
async function updateVersion() {
  // there is no need to do anything here.
  // Electron packager will to it for us.
}

/**
 * Watches for changed source files and copies them into the build directory.
 */
function watch() {

  gulp.watch(
    ['./src/**/*.js',
      './src/**/*.mjs',
      './src/**/*.html',
      './src/**/*.css',
      './src/**/*.xul',
      './src/**/*.dtd',
      './src/**/*.properties'],
    gulp.parallel(
      packageSrc,
      packageManageSieveUi,
      packageLibSieve,
      packageLibManageSieve)
  );
}

/**
 * Zip the windows electron app.
 */
async function zipWin32() {

  const version = (await common.getPackageVersion()).join(".");

  const source = path.resolve(OUTPUT_DIR_APP_WIN32);
  const destination = path.join(common.BASE_DIR_BUILD, `sieve-${version}-${WIN_PLATFORM}-${WIN_ARCH}.zip`);

  await common.compress(source, destination);
}

/**
 * Zip the linux electron app.
 */
async function zipLinux() {

  const version = (await common.getPackageVersion()).join(".");

  const source = path.resolve(path.join(OUTPUT_DIR_APP_LINUX));
  const destination = path.join(common.BASE_DIR_BUILD, `sieve-${version}-${LINUX_PLATFORM}-${LINUX_ARCH}.zip`);

  const options = {
    permissions: {
      "sieve": PERMISSIONS_EXECUTABLE,
      "*": PERMISSIONS_NORMAL
    }
  };

  await common.compress(source, destination, options);
}

/**
 * App Images enforce a very strict naming scheme, this means
 * we copy the staged files and do our adjustments
 *
 * @returns {stream}
 *   a stream to be consumed by gulp
 */
function packageAppImageDir() {

  return gulp.src([
    OUTPUT_DIR_APP_LINUX + "/**/*"
  ], { encoding: false}).pipe(gulp.dest(APP_IMAGE_DIR));
}

/**
 * Packages the AppDir related files into the app image folder.
 *
 * @returns {stream}
 *   a stream to be consumed by gulp
 */
function packageAppImageFiles() {

  const appImageFiles = path.join(common.BASE_DIR_COMMON, "/appImage/");

  return gulp.src([
    appImageFiles + "/**/*"
  ], { base: appImageFiles, encoding: false}).pipe(gulp.dest(APP_IMAGE_DIR));
}

/**
 * Creates a linux appImage Container
 */
async function packageAppImage() {

  let releases = await https.fetch(APP_IMAGE_RELEASE_URL);

  if (!releases)
    throw new Error("Could not load app image tool releases.");

  releases = releases
    .filter((a) => { return (a.tag_name.toLowerCase() !== "continuous"); })
    .filter((a) => { return (a.prerelease !== true); });

  if (!releases)
    throw new Error("Could not detect latest app image tool version.");

  let url = null;
  let tool = null;

  for (const release of releases) {
    for (const asset of release.assets) {
      if (asset.name.toLowerCase() !== APP_IMAGE_TOOL_NAME.toLowerCase())
        continue;

      url = asset.browser_download_url;
      tool = path.resolve(path.join(
        CACHE_DIR_APP, `appimagetool-v${release.tag_name}.AppImage`));

      break;
    }

    if (url && tool)
      break;
  }

  if (!url || !tool)
    throw new Error("Could not find appimagetool in any AppImageKit release.");

  if (!existsSync(tool))
    await https.download(url, tool);

  const RWX_RWX_RX = 0o775;
  await chmod(tool, RWX_RWX_RX);

  await chmod(path.resolve(path.join(APP_IMAGE_DIR, "AppRun")), RWX_RWX_RX);

  const version = (await common.getPackageVersion()).join(".");

  const source = path.resolve(APP_IMAGE_DIR);
  const destination = path.resolve(path.join(common.BASE_DIR_BUILD, `sieve-${version}-${LINUX_PLATFORM}-${LINUX_ARCH}.AppImage`));

  logger.info(`Packaging app image`);

  try {
    await (promisify(exec)(`${tool} "${source}" "${destination}"  2>&1`));
  } catch (ex) {
    logger.info(ex.stdout);
    throw ex;
  }
}

/**
 * Zip the macOS electron app.
 * On macOS we have to use zip, because yazl errors out at symbolic links.
 */
async function zipMacOS() {

  const version = (await common.getPackageVersion()).join(".");

  const source = path.resolve(OUTPUT_DIR_APP_MACOS);
  const destination = path.resolve(path.join(common.BASE_DIR_BUILD, `sieve-${version}-${MAC_PLATFORM}-${MAC_ARCH}.zip`));

  if (existsSync(destination)) {
    logger.info(`Deleting ${path.basename(destination)}`);
    await unlink(destination);
  }

  logger.info(`Compressing files ${source}/sieve.app`);
  logger.info(`Creating ${path.basename(destination)}`);

  process.chdir(`${source}/`);
  await (promisify(exec)(`zip -qry "${destination}" "sieve.app" 2>&1`));
}

export default {

  watch,

  updateVersion: updateVersion,

  packageDefinition: packageDefinition,
  packageDependencies: packageDependencies,
  packageCodeMirror: packageCodeMirror,
  packageBootstrap: packageBootstrap,
  packageLicense: packageLicense,
  packageSrc: packageSrc,
  packageLibManageSieve: packageLibManageSieve,
  packageLibSieve: packageLibSieve,
  packageManageSieveUi: packageManageSieveUi,

  packageWin32: packageWin32,
  packageLinux: packageLinux,
  packageDebian: packageDebian,
  packageMacOS: packageMacOS,

  zipWin32: zipWin32,
  zipLinux: zipLinux,
  zipMacOS: zipMacOS,

  appImageLinux: gulp.series(
    packageAppImageDir,
    packageAppImageFiles,
    packageAppImage
  ),

  packageApp: gulp.series(
    packageDefinition,
    packageDependencies,
    gulp.parallel(
      packageLicense,
      packageIcons,
      packageCodeMirror,
      packageBootstrap,
      packageLibManageSieve,
      packageLibSieve,
      packageManageSieveUi,
      packageSpamUi
    ),
    packageSrc
  ),

  BASE_DIR_APP: BASE_DIR_APP
};
