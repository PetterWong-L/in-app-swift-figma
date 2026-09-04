#!/usr/bin/env node

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BODY_LIMIT = 2 * 1024 * 1024;
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.mjs", ["app.mjs", "text/javascript; charset=utf-8"]],
  ["/i18n.mjs", ["i18n.mjs", "text/javascript; charset=utf-8"]],
  ["/model.mjs", ["model.mjs", "text/javascript; charset=utf-8"]],
  ["/task_ui.mjs", ["task_ui.mjs", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]]
]);
const API_ROUTES = new Map([
  ["/api/snapshot", ["GET", "snapshot"]],
  ["/api/validate", ["POST", "validate"]],
  ["/api/config", ["PUT", "save"]],
  ["/api/status", ["POST", "status"]],
  ["/api/shutdown", ["POST", "shutdown"]]
]);
const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src https://www.figma.com; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
};

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function createEditorServer({
  configPath,
  bridgePath,
  rubyPath = process.env.RUBY || "ruby",
  editorRoot,
  port = 0,
  openBrowser: _openBrowser = false
}) {
  for (const [name, value] of Object.entries({ configPath, bridgePath, editorRoot })) {
    if (typeof value !== "string" || !path.isAbsolute(value)) {
      throw new TypeError(`${name} must be an absolute path`);
    }
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TypeError("port must be an integer from 0 through 65535");
  }

  const token = randomBytes(32).toString("hex");
  let origin;
  let closing;
  const server = http.createServer(async (request, response) => {
    try {
      await handleRequest(request, response, {
        token,
        origin,
        configPath,
        bridgePath,
        rubyPath,
        editorRoot,
        close: () => closeServer(server)
      });
    } catch (error) {
      const handled = error instanceof HttpError
        ? error
        : new HttpError(500, "internal_error", "Unexpected local editor failure.");
      if (!response.headersSent) {
        sendJson(response, handled.status, {
          ok: false,
          status: handled.status,
          error: { code: handled.code, message: handled.message }
        });
      } else {
        response.destroy();
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;

  return {
    server,
    origin,
    url: `${origin}/#token=${token}`,
    token,
    close() {
      closing ||= closeServer(server);
      return closing;
    }
  };
}

async function handleRequest(request, response, context) {
  const requestUrl = new URL(request.url || "/", context.origin);
  if (request.headers.host !== new URL(context.origin).host) {
    throw new HttpError(403, "invalid_host", "Host is not allowed.");
  }

  const staticAsset = STATIC_FILES.get(requestUrl.pathname);
  if (staticAsset) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      throw new HttpError(405, "method_not_allowed", "Method is not allowed.");
    }
    const [filename, contentType] = staticAsset;
    const content = await readFile(path.join(context.editorRoot, filename));
    response.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": contentType });
    response.end(request.method === "HEAD" ? undefined : content);
    return;
  }

  const route = API_ROUTES.get(requestUrl.pathname);
  if (!route) {
    throw new HttpError(404, "not_found", "Route not found.");
  }
  const [method, operation] = route;
  if (request.method !== method) {
    throw new HttpError(405, "method_not_allowed", "Method is not allowed.");
  }
  if (request.headers.authorization !== `Bearer ${context.token}`) {
    throw new HttpError(401, "unauthorized", "A valid editor token is required.");
  }
  if (method !== "GET") {
    if (request.headers.origin !== context.origin) {
      throw new HttpError(403, "invalid_origin", "Origin is not allowed.");
    }
    const contentType = request.headers["content-type"] || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      throw new HttpError(415, "unsupported_media_type", "Content-Type must be application/json.");
    }
  }

  const body = method === "GET" ? {} : await readJsonBody(request);
  if (operation === "shutdown") {
    sendJson(response, 200, { ok: true, status: 200 });
    response.once("finish", () => context.close());
    return;
  }

  const payload = await invokeBridge(context, operation, body);
  sendJson(response, Number(payload.status) || 500, payload);
}

function readJsonBody(request) {
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (declaredLength > BODY_LIMIT) {
    request.resume();
    throw new HttpError(413, "body_too_large", "Request body exceeds 2 MiB.");
  }

  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new HttpError(413, "body_too_large", "Request body exceeds 2 MiB."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        const parsed = text.length === 0 ? {} : JSON.parse(text);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
          throw new Error("body must be an object");
        }
        resolve(parsed);
      } catch {
        reject(new HttpError(400, "invalid_json", "Request body must be a JSON object."));
      }
    });
    request.on("error", reject);
  });
}

function invokeBridge(context, operation, body) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      context.rubyPath,
      [context.bridgePath, operation, "--config", context.configPath],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        try {
          const payload = JSON.parse(stdout);
          if (!Number.isInteger(payload.status)) throw new Error("missing status");
          resolve(payload);
        } catch {
          reject(new HttpError(502, "bridge_failure", "Configuration service failed."));
        }
      }
    );
    child.on("error", () => reject(new HttpError(502, "bridge_failure", "Configuration service failed.")));
    child.stdin.end(JSON.stringify(body));
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeIdleConnections?.();
  });
}

async function main() {
  const args = process.argv.slice(2);
  const options = { port: 0, openBrowser: true };
  while (args.length) {
    const option = args.shift();
    if (option === "--no-open") {
      options.openBrowser = false;
    } else if (["--config", "--bridge", "--editor-root", "--ruby", "--port"].includes(option)) {
      const value = args.shift();
      if (value === undefined) throw new Error(`${option} requires a value`);
      if (option === "--config") options.configPath = value;
      if (option === "--bridge") options.bridgePath = value;
      if (option === "--editor-root") options.editorRoot = value;
      if (option === "--ruby") options.rubyPath = value;
      if (option === "--port") options.port = Number(value);
    } else {
      throw new Error(`unknown option ${option}`);
    }
  }

  const instance = await createEditorServer(options);
  process.stdout.write(`${instance.url}\n`);
  if (options.openBrowser && process.platform === "darwin") {
    execFile("open", [instance.url], () => {});
  }
  const shutdown = async () => {
    await instance.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  main().catch((error) => {
    process.stderr.write(`error: ${error.message}\n`);
    process.exit(1);
  });
}
