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

// Handle all imports..
import {
  SieveAbstractClient,
  TLS_SECURITY_EXPLICIT
} from "./SieveAbstractClient.mjs";

import {
  SieveCertValidationException,
  SieveClientException,
  SieveException
} from "./SieveExceptions.mjs";

import { SieveUrl } from "./SieveUrl.mjs";

/**
 *  This realizes the abstract sieve implementation by using
 *  the mozilla specific network implementation.
 */
class SieveMozClient extends SieveAbstractClient {

  /**
   * Invokes a privileged socket operation and retains its stage when
   * Thunderbird only returns a generic Experiment API error.
   *
   * @param {string} stage
   *   the socket setup stage.
   * @param {Function} callback
   *   the privileged operation.
   * @returns {*}
   *   the operation result.
   */
  async invokeSocketApi(stage, callback) {
    try {
      return await callback();
    } catch (ex) {
      throw new SieveClientException(`${stage}: ${ex.message || ex}`);
    }
  }

  /**
   * @inheritdoc
   */
  isAlive() {
    if (!super.isAlive(this))
      return false;

    return browser.sieve.socketV4.isAlive(this.socket);
  }

  /**
   * This method secures the connection to the sieve server. By activating
   * Transport Layer Security all Data exchanged is encrypted.
   *
   * Before calling this method you need to request a encrypted connection by
   * sending a startTLSRequest. Invoke this method immediately after the server
   * confirms switching to TLS.
   *
   **/
  async startTLS() {
    await super.startTLS();

    this.getLogger().logState("[SieveClient:startTLS()] Upgrading to secure socket");

    const tlsResult = await this.invokeSocketApi("Starting TLS", async () => {
      return await browser.sieve.socketV4.startTLS(this.socket);
    });

    let tls;
    try {
      tls = JSON.parse(tlsResult);
    } catch (ex) {
      throw new SieveClientException(
        `Starting TLS: Invalid response from the privileged API (${ex.message || ex})`);
    }

    if (tls && tls.error)
      throw new SieveClientException(`Starting TLS: ${tls.error}`);

    if (!tls || tls.ok !== true)
      throw new SieveClientException("Starting TLS: The privileged API did not confirm the upgrade");

    this.secured = true;
  }

  /**
   * @inheritdoc
   */
  async connect(url) {
    if (this.socket)
      return this;

    if (typeof url === 'string' || url instanceof String)
      url = new SieveUrl(url);

    this.host = url.getHost();
    this.port = url.getPort();

    this.security = TLS_SECURITY_EXPLICIT;

    this.getLogger().logState(`Connecting to ${this.host}:${this.port} ...`);

    const socketHost = `${this.host}`;
    const socketPort = `${this.port}`;

    const apiGeneration = await this.invokeSocketApi(
      "Probing the socket API v4", async () => {
        return await browser.sieve.socketV4.probe();
      });

    if (apiGeneration !== "sieve-socket-api-v4") {
      throw new SieveClientException(
        `Probing the socket API v4: Unexpected generation ${apiGeneration}`);
    }

    const creationResult = await this.invokeSocketApi("Creating the socket", async () => {
      return await browser.sieve.socketV4.create(
        socketHost, socketPort);
    });

    let creation;
    try {
      creation = JSON.parse(creationResult);
    } catch (ex) {
      throw new SieveClientException(
        `Creating the socket: Invalid response from the privileged API (${ex.message || ex})`);
    }

    if (creation && creation.error)
      throw new SieveClientException(`Creating the socket: ${creation.error}`);

    if (!creation || typeof creation.id !== "string" || !creation.id)
      throw new SieveClientException("Creating the socket: The privileged API returned no socket id");

    this.socket = creation.id;

    await this.invokeSocketApi("Registering the data listener", async () => {
      await browser.sieve.socketV4.onData.addListener((bytes) => {
        this.onData(bytes);
      }, this.socket);
    });

    await this.invokeSocketApi("Registering the error listener", async () => {
      await browser.sieve.socketV4.onError.addListener(async (error) => {
        this.getLogger().logState(`SieveClient: OnError (Connection ${this.host}:${this.port})`);

        // Exceptions can't be transferred between experiments and background pages
        // This means we need to convert the error object into an exception.
        if (error && error.type === "CertValidationError")
          error = new SieveCertValidationException(error);
        else if (error && error.type === "SocketError")
          error = new SieveClientException(error.message);
        else
          error = new SieveException(`Socket failed without providing an error code.`);

        if ((this.listener) && (this.listener.onError))
          await this.listener.onError(error);
      }, this.socket);
    });

    await this.invokeSocketApi("Registering the close listener", async () => {
      await browser.sieve.socketV4.onClose.addListener(async () => {
        this.getLogger().logState(`SieveClient: OnClose (Connection ${this.host}:${this.port})`);

        await this.disconnect(new Error("Server closed connection unexpectedly"));
      }, this.socket);
    });

    await this.invokeSocketApi("Starting the network connection", async () => {
      await browser.sieve.socketV4.connect(this.socket);
    });

    return this;
  }

  /**
   * @inheritdoc
   */
  async destroy() {
    this.getLogger().logState(`[SieveClient:destroy()] ... destroying socket...`);
    await this.invokeSocketApi("Destroying the socket", async () => {
      await browser.sieve.socketV4.destroy(this.socket);
    });
    this.socket = null;
  }

  /**
   * @inheritdoc
   */
  async onSend(data) {

    // Convert string into an UTF-8 array...
    const output = Array.prototype.slice.call(
      (new TextEncoder()).encode(data));

    if (this.getLogger().isLevelStream())
      this.getLogger().logStream(`Client -> Server [Byte Array]:\n${output}`);

    await this.invokeSocketApi("Sending data", async () => {
      await browser.sieve.socketV4.send(this.socket, output);
    });
  }
}

export { SieveMozClient as Sieve };
