import EventEmitter from "events";
import { Zalo, LoginQRCallbackEventType } from "zca-js";
import { HttpsProxyAgent } from "https-proxy-agent";
import { ProxyAgent } from "undici";
import { listAccounts, addAccount, getAccount } from "../core/accounts.js";
import { loadCredentials, saveCredentials } from "../core/credentials.js";
import { info, error, warning } from "../utils/output.js";

// Same image metadata getter as in zalo-client.js
import fs from "fs";

async function readImageMetadata(filePath) {
    const stat = await fs.promises.stat(filePath);
    const buf = Buffer.alloc(32);
    const fh = await fs.promises.open(filePath, "r");
    try {
        await fh.read(buf, 0, 32, 0);
    } finally {
        await fh.close();
    }

    let width = 0;
    let height = 0;

    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
        width = buf.readUInt32BE(16);
        height = buf.readUInt32BE(20);
    } else if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
        width = buf.readUInt16LE(6);
        height = buf.readUInt16LE(8);
    } else if (buf[0] === 0xff && buf[1] === 0xd8) {
        const jfh = await fs.promises.open(filePath, "r");
        try {
            const seg = Buffer.alloc(9);
            let pos = 2;
            while (pos < stat.size - 9) {
                const { bytesRead } = await jfh.read(seg, 0, 4, pos);
                if (bytesRead < 4 || seg[0] !== 0xff) break;
                const marker = seg[1];
                if (
                    (marker >= 0xc0 && marker <= 0xc3) ||
                    (marker >= 0xc5 && marker <= 0xc7) ||
                    (marker >= 0xc9 && marker <= 0xcb) ||
                    (marker >= 0xcd && marker <= 0xcf)
                ) {
                    await jfh.read(seg, 0, 7, pos + 2);
                    height = seg.readUInt16BE(3);
                    width = seg.readUInt16BE(5);
                    break;
                }
                const segLen = seg.readUInt16BE(2);
                pos += 2 + segLen;
            }
        } finally {
            await jfh.close();
        }
    }

    if (width === 0 || height === 0) return null;
    return { width, height, size: stat.size };
}

function createProxyFetch(proxyUrl) {
    const dispatcher = new ProxyAgent(proxyUrl);
    return (url, init = {}) => fetch(url, { ...init, dispatcher });
}

function createZalo(proxyUrl) {
    const opts = {
        logging: !process.env.ZALO_JSON_MODE,
        imageMetadataGetter: readImageMetadata,
    };
    if (proxyUrl) {
        opts.agent = new HttpsProxyAgent(proxyUrl);
        opts.polyfill = createProxyFetch(proxyUrl);
    }
    return new Zalo(opts);
}

class ZaloManager extends EventEmitter {
    constructor() {
        super();
        this.instances = new Map(); // ownId -> api
    }

    async initAll() {
        const accounts = listAccounts();
        info(`Starting ZaloManager for ${accounts.length} accounts...`);
        for (const account of accounts) {
            await this.startAccount(account.ownId, account.proxy);
        }
    }

    async startAccount(ownId, proxyUrl) {
        if (this.instances.has(ownId)) return;

        const creds = loadCredentials(ownId);
        if (!creds) {
            warning(`No credentials found for account ${ownId}, skipping.`);
            return;
        }

        try {
            const zalo = createZalo(proxyUrl);
            const api = await zalo.login(creds);
            const loggedInId = api.getOwnId?.() || ownId;

            this.instances.set(loggedInId, api);
            this.attachListener(api, loggedInId, proxyUrl);

            info(`Successfully logged in and started listener for ${loggedInId}`);
        } catch (e) {
            error(`Failed to start account ${ownId}: ${e.message}`);
        }
    }

    attachListener(api, ownId, proxyUrl) {
        const eventsToListen = ["message", "friend_event", "group_event", "reaction"];

        eventsToListen.forEach(eventType => {
            api.listener.on(eventType, (msg) => {
                this.emit("zalo_event", {
                    ownId,
                    eventType,
                    data: msg
                });
            });
        });

        api.listener.on("error", (err) => {
            error(`[Account ${ownId}] Listener error: ${err?.message || err}`);
        });

        api.listener.on("closed", async (code) => {
            if (code === 3000) {
                warning(`Account ${ownId} closed (Duplicate connection). Stopped reconnecting.`);
                this.instances.delete(ownId);
                return;
            }
            warning(`Connection closed for ${ownId} (code: ${code}). Re-login in 5s...`);
            this.instances.delete(ownId);
            await new Promise((r) => setTimeout(r, 5000));
            this.startAccount(ownId, proxyUrl);
        });

        api.listener.start({ retryOnClose: true });
    }

    async loginWithQR(proxyUrl = null, onQrGenerated = null) {
        const zalo = createZalo(proxyUrl);

        const api = await zalo.loginQR(null, (event) => {
            if (event.type === LoginQRCallbackEventType.QRCodeGenerated && onQrGenerated) {
                onQrGenerated(event);
            }
        });

        const ownId = api.getOwnId?.() || null;
        if (!ownId) throw new Error("Login failed: no ownId returned");

        const ctx = api.getContext();
        const creds = {
            imei: ctx.imei,
            cookie: ctx.cookie,
            userAgent: ctx.userAgent,
            language: ctx.language,
        };

        // Fetch profile to get display name
        let displayName = "";
        try {
            const accountInfo = await api.fetchAccountInfo();
            displayName = accountInfo?.profile?.displayName || ownId;
        } catch {}

        saveCredentials(ownId, creds);
        addAccount(ownId, displayName, proxyUrl);

        if (this.instances.has(ownId)) {
            try { this.instances.get(ownId).listener.stop(); } catch {}
        }

        this.instances.set(ownId, api);
        this.attachListener(api, ownId, proxyUrl);

        return { api, ownId, displayName };
    }

    getApi(ownId) {
        return this.instances.get(ownId) || null;
    }
}

export const manager = new ZaloManager();
