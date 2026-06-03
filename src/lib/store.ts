import { promises as fs } from "node:fs";
import path from "node:path";
import type { Snapshot } from "@/lib/types";

// Snapshot persistence. Uses Upstash Redis when configured (production),
// otherwise falls back to a local JSON file so `npm run refresh:local` +
// `npm run dev` work with no external services.
//
// The Vercel Marketplace "Upstash Redis" integration injects the REST URL/token
// under either UPSTASH_* or KV_* names depending on when the store was created,
// so we accept both.

const REDIS_KEY = "snapshot:v1";
const LOCAL_FILE = path.join(process.cwd(), "data", "snapshot.json");

// Find an env var by exact name first, then by suffix. The Vercel Upstash/KV
// integration prefixes the names depending on how it was connected (e.g.
// `KV_REST_API_URL` or `UPSTASH_REDIS_REST_KV_REST_API_URL`), so suffix-matching
// lets us pick them up without the caller knowing the exact prefix.
function findEnv(suffix: string, exclude?: string): string | undefined {
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    if (exclude && key.includes(exclude)) continue;
    if (key.endsWith(suffix)) return value;
  }
  return undefined;
}

function redisCreds(): { url: string; token: string } | null {
  const url = findEnv("REST_API_URL") ?? findEnv("REDIS_REST_URL");
  // Must be a WRITE token (setSnapshot writes), so skip read-only tokens.
  const token =
    findEnv("REST_API_TOKEN", "READ_ONLY") ?? findEnv("REDIS_REST_TOKEN", "READ_ONLY");
  return url && token ? { url, token } : null;
}

// Human-readable description of where snapshots are read/written, for logging.
export function storeTarget(): string {
  const creds = redisCreds();
  if (creds) {
    try {
      return `Upstash Redis (${new URL(creds.url).host})`;
    } catch {
      return "Upstash Redis";
    }
  }
  return `local file (${path.relative(process.cwd(), LOCAL_FILE)})`;
}

async function getRedis() {
  const creds = redisCreds();
  if (!creds) return null;
  const { Redis } = await import("@upstash/redis");
  // We (de)serialize ourselves (gzip, below), so disable the client's auto-JSON.
  return new Redis({ ...creds, automaticDeserialization: false });
}

// The full snapshot (~1.3MB JSON for 600 companies) exceeds Upstash's 1MB
// per-request limit, so we gzip it (~200KB) and store base64. The prefix tags the
// payload; legacy plain-JSON values are still readable for backward compatibility.
const GZIP_PREFIX = "gz:";

async function encodeSnapshot(snapshot: Snapshot): Promise<string> {
  const { gzipSync } = await import("node:zlib");
  const gz = gzipSync(Buffer.from(JSON.stringify(snapshot)));
  return GZIP_PREFIX + gz.toString("base64");
}

async function decodeSnapshot(raw: string | null): Promise<Snapshot | null> {
  if (!raw) return null;
  if (raw.startsWith(GZIP_PREFIX)) {
    const { gunzipSync } = await import("node:zlib");
    const buf = Buffer.from(raw.slice(GZIP_PREFIX.length), "base64");
    return JSON.parse(gunzipSync(buf).toString("utf8")) as Snapshot;
  }
  return JSON.parse(raw) as Snapshot; // legacy uncompressed JSON
}

export async function setSnapshot(snapshot: Snapshot): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    await redis.set(REDIS_KEY, await encodeSnapshot(snapshot));
    return;
  }
  await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
  await fs.writeFile(LOCAL_FILE, JSON.stringify(snapshot, null, 2), "utf8");
}

export async function getSnapshot(): Promise<Snapshot | null> {
  const redis = await getRedis();
  if (redis) {
    return decodeSnapshot(await redis.get<string>(REDIS_KEY));
  }
  try {
    const raw = await fs.readFile(LOCAL_FILE, "utf8");
    return JSON.parse(raw) as Snapshot;
  } catch {
    return null;
  }
}
