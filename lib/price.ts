import { z } from "zod";
import { usdTargets } from "./economics";
// Short-lived cache only: financial records and ownership never rely on isolate memory.
let cache: { solUsd: number; asOf: number; fetchedAt: number; stale: boolean; targets: ReturnType<typeof usdTargets> } | null = null;
export async function solPrice() {
  if (cache && Date.now() - cache.fetchedAt < 30000) return cache;
  try {
    const res = await fetch("https://frontend-api-v3.pump.fun/sol-price", { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error("Price unavailable");
    const d = z.object({ solPrice: z.number().finite().positive(), asOfTimestamp: z.number().optional(), stale: z.boolean().optional() }).parse(await res.json());
    const asOf = d.asOfTimestamp || Date.now();
    cache = { solUsd: d.solPrice, asOf, fetchedAt: Date.now(), stale: d.stale === true || Math.abs(Date.now() - asOf) > 120000, targets: usdTargets(d.solPrice) }; return cache;
  } catch { if (cache) return { ...cache, stale: true }; return null; }
}
