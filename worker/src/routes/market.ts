import type { Env } from '../index';
import { cachedFetchWithFallback } from '../lib/cache';
import { fetchJSON, delay } from '../lib/upstream';

const CG = 'https://api.coingecko.com/api/v3/coins/markets';
const PARAMS = 'vs_currency=usd&order=market_cap_desc&per_page=250&sparkline=true&price_change_percentage=1h,24h,7d,30d';

interface CGCoin {
  id: string;
  symbol: string;
  name: string;
  current_price: number | null;
  market_cap: number | null;
  [key: string]: unknown;
}

export function handleMarket(request: Request, ctx: ExecutionContext, env: Env): Promise<Response> {
  const hdr = { 'x-cg-demo-api-key': env.CG_API_KEY };
  return cachedFetchWithFallback(request, ctx, '/cache/market', 60, async () => {
    const page1 = await fetchJSON<CGCoin[]>(`${CG}?${PARAMS}&page=1`, 15000, hdr);
    await delay(2000);
    const page2 = await fetchJSON<CGCoin[]>(`${CG}?${PARAMS}&page=2`, 15000, hdr);

    const seen = new Set<string>();
    const merged: CGCoin[] = [];
    for (const coin of [...page1, ...page2]) {
      if (!coin.id || seen.has(coin.id)) continue;
      seen.add(coin.id);
      merged.push(coin);
    }
    return merged;
  });
}
