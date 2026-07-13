import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

import { runHydraDbLiveRetrieve, runRocketRideLiveCheck } from "./src/server/live-tools/status";

function sendJson(response: { statusCode: number; setHeader(name: string, value: string): void; end(body?: string): void }, statusCode: number, value: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(value));
}

function readJsonBody(request: { on(event: "data", callback: (chunk: Buffer) => void): void; on(event: "end", callback: () => void): void; on(event: "error", callback: (error: Error) => void): void }): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) return resolve({});
      try {
        return resolve(JSON.parse(text) as Record<string, unknown>);
      } catch (error) {
        return reject(error);
      }
    });
  });
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "agentproof-live-tools",
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          if (!request.url?.startsWith("/api/")) return next();
          if (request.method !== "GET" && request.method !== "POST") {
            return sendJson(response, 405, { error: "Method not allowed" });
          }

          try {
            const body = request.method === "POST" ? await readJsonBody(request) : {};
            if (request.url.startsWith("/api/hydradb/live-retrieve")) {
              return sendJson(response, 200, await runHydraDbLiveRetrieve(process.env, {
                buyerId: typeof body.buyerId === "string" ? body.buyerId : undefined,
                task: typeof body.task === "string" ? body.task : undefined,
                requiredSkillIds: stringArray(body.requiredSkillIds),
              }));
            }
            if (request.url.startsWith("/api/rocketride/live-check")) {
              return sendJson(response, 200, await runRocketRideLiveCheck(process.env, {
                task: typeof body.task === "string" ? body.task : undefined,
              }));
            }
            return sendJson(response, 404, { error: "Unknown AgentProof API route" });
          } catch (error) {
            return sendJson(response, 500, {
              error: "AgentProof live tool route failed",
              message: error instanceof Error ? error.message : "unknown error",
            });
          }
        });
      },
    },
  ],
});
