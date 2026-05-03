import express from "express";
import { manager } from "./manager.js";
import { listAccounts, getAccount, removeAccount } from "../core/accounts.js";
import { maskProxy } from "../utils/proxy-helpers.js";

const router = express.Router();

// Active QR sessions
const qrSessions = new Map();

router.get("/accounts", (req, res) => {
    const accounts = listAccounts().map(a => ({
        ...a,
        proxy: maskProxy(a.proxy),
        connected: manager.instances.has(a.ownId)
    }));
    res.json(accounts);
});

router.delete("/accounts/:id", (req, res) => {
    const ownId = req.params.id;
    if (removeAccount(ownId)) {
        const api = manager.instances.get(ownId);
        if (api) {
            try { api.listener.stop(); } catch {}
            manager.instances.delete(ownId);
        }
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "Account not found" });
    }
});

router.post("/login/qr", async (req, res) => {
    const sessionId = Math.random().toString(36).substring(7);
    const { proxyUrl } = req.body || {};

    qrSessions.set(sessionId, { status: "pending", qrData: null, event: null });

    // Cleanup to prevent memory leak
    setTimeout(() => {
        qrSessions.delete(sessionId);
    }, 10 * 60 * 1000); // Remove after 10 mins

    // Start login asynchronously
    manager.loginWithQR(proxyUrl, (event) => {
        const session = qrSessions.get(sessionId);
        if (session) {
            // event.image is a Buffer. Convert to base64.
            session.qrData = Buffer.isBuffer(event.image) ? event.image.toString("base64") : event.image;
            session.event = event;
        }
    }).then(({ ownId, displayName }) => {
        const session = qrSessions.get(sessionId);
        if (session) {
            session.status = "success";
            session.ownId = ownId;
            session.displayName = displayName;
        }
    }).catch(err => {
        const session = qrSessions.get(sessionId);
        if (session) {
            session.status = "error";
            session.error = err.message;
        }
    });

    res.json({ sessionId });
});

router.get("/login/qr/:sessionId", (req, res) => {
    const session = qrSessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });

    res.json({
        status: session.status,
        qrData: session.qrData, // Base64 image
        ownId: session.ownId,
        displayName: session.displayName,
        error: session.error
    });

    // Automatically delete session if it reached a final state to prevent memory leak
    if (session.status === "success" || session.status === "error") {
        qrSessions.delete(req.params.sessionId);
    }
});

// Generic invoke endpoint to call ANY api method directly, acting as a true proxy
router.post("/invoke", async (req, res) => {
    const { accountId, method, args } = req.body;

    if (!accountId || !method) {
        return res.status(400).json({ error: "accountId and method are required" });
    }

    const api = manager.getApi(accountId);
    if (!api) {
        return res.status(404).json({ error: "Account not found or not connected" });
    }

    if (typeof api[method] !== 'function') {
        return res.status(400).json({ error: `Method ${method} not found on Zalo API` });
    }

    try {
        const result = await api[method](...(args || []));
        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
