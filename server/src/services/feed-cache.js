/**
 * Server-side in-memory cache for RapidAPI feed responses and the assembled discover payload.
 * Configurable TTL via env vars. Prevents redundant API calls across multiple endpoints
 * that all need the same news data within a short window.
 */

const caches = new Map();

export function getCachedOrNull(key, ttlMs) {
  const entry = caches.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > ttlMs) {
    caches.delete(key);
    return null;
  }
  return entry.value;
}

export function setCache(key, value) {
  caches.set(key, { at: Date.now(), value });
  if (caches.size > 50) {
    const oldest = [...caches.entries()].sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < oldest.length - 40; i++) caches.delete(oldest[i][0]);
  }
}

export function getFeedCacheTtl(env = process.env) {
  return Math.max(30_000, Number(env.RAPIDAPI_CACHE_MS) || 900_000);
}

export function getDiscoverPayloadCacheTtl(env = process.env) {
  return Math.max(30_000, Number(env.DISCOVER_PAYLOAD_CACHE_MS) || 300_000);
}

/** Clears news/discover caches only — not Schwab market-data cache. */
export function clearAllCaches() {
  for (const k of [...caches.keys()]) {
    if (k.startsWith("feed:") || k.startsWith("discover_payload:")) {
      caches.delete(k);
    }
  }
}
