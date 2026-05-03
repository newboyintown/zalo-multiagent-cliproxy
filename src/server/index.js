import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import routes from "./routes.js";
import { manager } from "./manager.js";
import { info, success } from "../utils/output.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function startServer(port = 3000, webhookUrl = null) {
    const app = express();

    app.use(express.json());

    // Serve static files for the WebUI
    app.use(express.static(path.join(__dirname, "public")));

    // Mount the API routes
    app.use("/api", routes);

    app.listen(port, () => {
        success(`Zalo Agent Proxy WebUI running at http://localhost:${port}`);

        // Initialize the manager and start all logged-in accounts
        manager.initAll();

        // Forward incoming events
        manager.on("zalo_event", async ({ ownId, eventType, data }) => {
            info(`[Account ${ownId}] Received ${eventType} event`);

            if (webhookUrl) {
                try {
                    await fetch(webhookUrl, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ accountId: ownId, event: eventType, data }),
                    });
                } catch (e) {
                    info(`Failed to post to webhook: ${e.message}`);
                }
            }
        });
    });
}
