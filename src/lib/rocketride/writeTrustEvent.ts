import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TrustEvent } from "../../types/contracts";
import { assertValidTrustEvent } from "./validate";

const DEFAULT_OUT_DIR = path.resolve(process.cwd(), "rocketride/samples/out");

/**
 * R6 fallback handoff: validate a TrustEvent against the contract and write
 * it to rocketride/samples/out/ for manual HydraDB ingest. Used until the
 * HydraDB ingest endpoint exists; superseded by an HTTP POST once it does.
 */
export async function writeTrustEvent(event: TrustEvent, outDir = DEFAULT_OUT_DIR): Promise<string> {
  assertValidTrustEvent(event);
  await mkdir(outDir, { recursive: true });
  const filePath = path.join(outDir, `${event.trust_event_id}.json`);
  await writeFile(filePath, `${JSON.stringify(event, null, 2)}\n`, "utf-8");
  return filePath;
}
