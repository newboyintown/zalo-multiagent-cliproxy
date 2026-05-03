import { startServer } from "../server/index.js";
import { info } from "../utils/output.js";

export function registerServerCommand(program) {
    program
        .command("server")
        .description("Start the local HTTP Proxy Server and WebUI for multi-account management")
        .option("-p, --port <port>", "Port for the HTTP server", parseInt, 3000)
        .option("--webhook <url>", "Webhook URL to POST incoming messages and events")
        .action((opts) => {
            info(`Starting proxy server...`);
            startServer(opts.port, opts.webhook);
        });
}
