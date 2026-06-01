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

function redisCreds(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

async function getRedis() {
  const creds = redisCreds();
  if (!creds) return null;
  const { Redis } = await import("@upstash/redis");
  return new Redis(creds);
}

export async function setSnapshot(snapshot: Snapshot): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    // @upstash/redis serializes objects to JSON automatically.
    await redis.set(REDIS_KEY, snapshot);
    return;
  }
  await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
  await fs.writeFile(LOCAL_FILE, JSON.stringify(snapshot, null, 2), "utf8");
}

export async function getSnapshot(): Promise<Snapshot | null> {
  const redis = await getRedis();
  if (redis) {
    return (await redis.get<Snapshot>(REDIS_KEY)) ?? null;
  }
  try {
    const raw = await fs.readFile(LOCAL_FILE, "utf8");
    return JSON.parse(raw) as Snapshot;
  } catch {
    return null;
  }
}
