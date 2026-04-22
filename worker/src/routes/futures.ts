import { cachedFetchWithFallback } from '../lib/cache';
import { fetchJSON } from '../lib/upstream';

export function handleFunding(request: Request, ctx: ExecutionContext): Promise<Response> {
  return cachedFetchWithFallback(request, ctx, '/cache/funding', 60, () =>
    fetchJSON<unknown[]>('https://fapi.binance.com/fapi/v1/premiumIndex'),
  );
}

export function handleLiquidations(request: Request, ctx: ExecutionContext): Promise<Response> {
  return cachedFetchWithFallback(request, ctx, '/cache/liquidations', 30, () =>
    fetchJSON<unknown[]>('https://fapi.binance.com/fapi/v1/allForceOrders'),
  );
}
