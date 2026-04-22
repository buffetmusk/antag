import type { Env } from '../index';
import { cachedFetchWithFallback } from '../lib/cache';
import { fetchJSON } from '../lib/upstream';

interface CGGlobal {
  data: {
    total_market_cap: { usd: number };
    market_cap_percentage: { btc: number };
    [key: string]: unknown;
  };
}

interface FNGResponse {
  data: Array<{ value: string; value_classification: string }>;
}

export function handleGlobal(request: Request, ctx: ExecutionContext, env: Env): Promise<Response> {
  const hdr = { 'x-cg-demo-api-key': env.CG_API_KEY };
  return cachedFetchWithFallback(request, ctx, '/cache/global', 60, async () => {
    const [globalRes, fngRes] = await Promise.allSettled([
      fetchJSON<CGGlobal>('https://api.coingecko.com/api/v3/global', 10000, hdr),
      fetchJSON<FNGResponse>('https://api.alternative.me/fng/?limit=1'),
    ]);

    return {
      global: globalRes.status === 'fulfilled' ? globalRes.value.data : null,
      fearGreed: fngRes.status === 'fulfilled' ? fngRes.value.data?.[0] ?? null : null,
    };
  });
}
