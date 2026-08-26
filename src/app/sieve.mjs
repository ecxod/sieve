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

import path from 'path';
import url from 'url';
import SieveSentry from './sentry.cjs';
import { createHash } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdtemp, rename, rm } from 'fs/promises';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { SieveUpdater } from './libs/managesieve.ui/updater/SieveUpdater.mjs';

import {
  app,
  ipcMain,
  dialog,
  safeStorage,
  BrowserWindow,
  Menu,
  net,
  shell
} from 'electron';

const DEFAULT_WINDOW_WIDTH = 1200;
const DEFAULT_WINDOW_HEIGHT = 600;
const UPDATE_QUIT_DELAY_MS = 750;

/**
 * Downloads, verifies and starts a published Windows installer.
 *
 * Installer metadata is accepted only for the versioned ecxod/sieve GitHub
 * release URL and must include GitHub's SHA-256 digest.
 *
 * @param {object} data
 *   installer metadata returned by the update checker.
 * @returns {object}
 *   launch result.
 */
async function downloadAndStartUpdate(data) {
  if (process.platform !== "win32")
    throw new Error("Automatic update installation is available only on Windows");

  const installer = (new SieveUpdater()).validateInstaller(data);
  const downloadDirectory = await mkdtemp(
    path.join(app.getPath("temp"), "sieve-update-"));
  const partialPath = path.join(downloadDirectory, `${installer.name}.download`);
  const installerPath = path.join(downloadDirectory, installer.name);
  let keepDownload = false;

  try {
    const response = await net.fetch(installer.url, {
      redirect: "follow",
      headers: {
        "Accept": "application/octet-stream"
      }
    });

    if (!response.ok || !response.body)
      throw new Error(`Update download failed with HTTP ${response.status}`);

    const advertisedLength = Number.parseInt(
      response.headers.get("content-length"), 10);
    if (Number.isInteger(advertisedLength) && advertisedLength !== installer.size)
      throw new Error("The update download size does not match the GitHub release");

    const hash = createHash("sha256");
    let received = 0;
    const verifier = new Transform({
      transform(chunk, encoding, callback) {
        received += chunk.length;

        if (received > installer.size) {
          callback(new Error("The update download is larger than expected"));
          return;
        }

        hash.update(chunk);
        callback(null, chunk);
      }
    });

    await pipeline(
      Readable.fromWeb(response.body),
      verifier,
      createWriteStream(partialPath, { flags: "wx", mode: 0o600 }));

    if (received !== installer.size)
      throw new Error("The update download is incomplete");

    const actualDigest = `sha256:${hash.digest("hex")}`;
    if (actualDigest !== installer.digest)
      throw new Error("The update installer failed SHA-256 verification");

    await rename(partialPath, installerPath);

    const error = await shell.openPath(installerPath);
    if (error)
      throw new Error(`Could not start the update installer: ${error}`);

    keepDownload = true;
    setTimeout(() => { app.quit(); }, UPDATE_QUIT_DELAY_MS);

    return { started: true, version: installer.version };
  } finally {
    if (!keepDownload)
      await rm(downloadDirectory, { recursive: true, force: true });
  }
}

// Out main window, it defines the lifecycle of your application
// so we need to protect it from the garbage collector and keep a
// global reference active. Otherwise the window will be automatically
// cleaned up and thus closed.

let win = null;

/**
 * Creates the main window
 */
async function createWindow() {

  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

  let icon = undefined;
  if (process.platform === "linux")
    icon = path.join(__dirname, 'libs/icons/linux.png');

  // Create the browser window.
  win = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    icon: icon,
    webPreferences: {
      // nodeIntegrationInSubFrames: true,
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Hide the menu bar.
  win.removeMenu();

  await win.loadFile('app.html');

  // Open the DevTools.
  // win.webContents.openDevTools();

  // Emitted when the window is closed.
  win.on('closed', () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    win = null;
  });

  // As suggested in https://github.com/electron/electron/issues/4068
  const inputMenu = Menu.buildFromTemplate([
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' }
  ]);

  win.webContents.on('context-menu', (e, props) => {
    const { isEditable } = props;
    if (isEditable) {
      inputMenu.popup(win);
    }
  });

  // win.webContents.on('will-navigate', handleRedirect);
  win.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith("https://"))
      shell.openExternal(details.url);

    return { action: 'deny'};
  });
}

/**
 * The main entry point into this application.
 */
async function main() {

  // ensure we are running as a singleton.
  const isLocked = app.requestSingleInstanceLock();

  if (!isLocked) {
    // eslint-disable-next-line no-console
    console.log("Exiting app is locked");
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    // Someone tried to run a second instance, we should focus our window.
    if (!win)
      return;

    if (win.isMinimized());
    win.restore();

    win.focus();
  });

  ipcMain.handle("open-dialog", async(event, options) => {
    return await dialog.showOpenDialog(options);
  });

  ipcMain.handle("save-dialog", async(event, options) => {
    return await dialog.showSaveDialog(options);
  });

  ipcMain.handle("get-version", async() => {
    return await app.getVersion();
  });

  ipcMain.handle("install-update", async(event, installer) => {
    return await downloadAndStartUpdate(installer);
  });

  ipcMain.handle("sentry-get-dsn", () => {
    return SieveSentry.getDsn();
  });

  ipcMain.handle("sentry-set-dsn", (event, dsn) => {
    return SieveSentry.setDsn(dsn);
  });

  ipcMain.handle("open-developer-tools", () => {
    // Open the DevTools.
    win.webContents.openDevTools({
      "mode": "detach",
      "activate" : true
    });
  });

  ipcMain.handle("reload-ui", () => {
    // Force reload...
    win.webContents.reloadIgnoringCache();
  });

  ipcMain.handle("has-encryption", () => {
    return safeStorage.isEncryptionAvailable();
  });

  ipcMain.handle("encrypt-string", (event, plainText) => {
    return safeStorage.encryptString(plainText).toString('hex');
  });

  ipcMain.handle("decrypt-string", (event, encrypted) => {
    return safeStorage.decryptString(Buffer.from(encrypted, "hex"));
  });


  // Wait until electron is completely up, otherwise some API might not be ready.
  await app.whenReady();

  await createWindow();

  // Quit when all windows are closed.
  app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) {
      createWindow();
    }
  });

  // In this file you can include the rest of your app's specific main process
  // code. You can also put them in separate files and require them here.

}

export {
  main
};
