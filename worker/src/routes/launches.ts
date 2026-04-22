import type { Env } from '../index';
import { cachedFetchWithFallback } from '../lib/cache';
import { fetchJSON } from '../lib/upstream';

const CG = 'https://api.coingecko.com/api/v3/coins/markets';
const PARAMS = 'vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=1h,24h,7d,30d';

const CATEGORIES: Record<string, string> = {
  alpha: 'binance-alpha-spotlight',
  launchpad: 'binance-launchpad',
  launchpool: 'binance-launchpool',
  megadrop: 'binance-megadrop',
};

export function handleLaunches(request: Request, ctx: ExecutionContext, env: Env): Promise<Response> {
  const hdr = { 'x-cg-demo-api-key': env.CG_API_KEY };
  return cachedFetchWithFallback(request, ctx, '/cache/launches', 120, async () => {
    const entries = Object.entries(CATEGORIES);
    const results = await Promise.allSettled(
      entries.map(([, cat]) => fetchJSON<unknown[]>(`${CG}?${PARAMS}&category=${cat}`, 10000, hdr)),
    );

    const data: Record<string, unknown[]> = {};
    entries.forEach(([key], i) => {
      const r = results[i];
      data[key] = r.status === 'fulfilled' ? r.value : [];
    });
    return data;
  });
}
