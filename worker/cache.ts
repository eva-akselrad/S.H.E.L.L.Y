/** Edge-cache a JSON-producing function using the Workers Cache API. */
export async function cached<T>(
  ctx: ExecutionContext,
  key: string,
  ttlSeconds: number,
  produce: () => Promise<T>,
): Promise<{ data: T; hit: boolean }> {
  const cache = caches.default;
  const cacheKey = new Request(`https://cache.shelly.internal/${key}`);
  const found = await cache.match(cacheKey);
  if (found) return { data: (await found.json()) as T, hit: true };

  const data = await produce();
  const res = new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttlSeconds}` },
  });
  ctx.waitUntil(cache.put(cacheKey, res));
  return { data, hit: false };
}

export function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
