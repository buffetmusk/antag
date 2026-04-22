import { cachedFetchWithFallback } from '../lib/cache';
import { fetchJSON } from '../lib/upstream';

interface BinanceInfo {
  symbols: Array<{ baseAsset: string; quoteAsset: string; status: string }>;
}

interface BybitInfo {
  result: { list: Array<{ baseCoin: string; quoteCoin: string; status: string }> };
}

interface OKXInfo {
  data: Array<{ baseCcy: string; quoteCcy: string; state: string }>;
}

interface GatePair {
  base: string;
  quote: string;
  trade_status: string;
}

function extractSymbols(
  binance: BinanceInfo | null,
  bybit: BybitInfo | null,
  okx: OKXInfo | null,
  gate: GatePair[] | null,
): Record<string, string[]> {
  const map: Record<string, string[]> = {};

  const add = (sym: string, exch: string) => {
    const s = sym.toUpperCase();
    if (!map[s]) map[s] = [];
    if (!map[s].includes(exch)) map[s].push(exch);
  };

  if (binance) {
    for (const s of binance.symbols) {
      if (s.quoteAsset === 'USDT' && s.status === 'TRADING') add(s.baseAsset, 'Binance');
    }
  }
  if (bybit) {
    for (const s of bybit.result.list) {
      if (s.quoteCoin === 'USDT' && s.status === 'Trading') add(s.baseCoin, 'Bybit');
    }
  }
  if (okx) {
    for (const s of okx.data) {
      if (s.quoteCcy === 'USDT' && s.state === 'live') add(s.baseCcy, 'OKX');
    }
  }
  if (gate) {
    for (const p of gate) {
      if (p.quote === 'USDT' && p.trade_status === 'tradable') add(p.base, 'Gate.io');
    }
  }

  return map;
}

export function handleExchanges(request: Request, ctx: ExecutionContext): Promise<Response> {
  return cachedFetchWithFallback(request, ctx, '/cache/exchanges', 3600, async () => {
    const [binRes, byRes, okRes, gaRes] = await Promise.allSettled([
      fetchJSON<BinanceInfo>('https://api.binance.com/api/v3/exchangeInfo'),
      fetchJSON<BybitInfo>('https://api.bybit.com/v5/market/instruments-info?category=spot'),
      fetchJSON<OKXInfo>('https://www.okx.com/api/v5/public/instruments?instType=SPOT'),
      fetchJSON<GatePair[]>('https://api.gateio.ws/api/v4/spot/currency_pairs'),
    ]);

    return extractSymbols(
      binRes.status === 'fulfilled' ? binRes.value : null,
      byRes.status === 'fulfilled' ? byRes.value : null,
      okRes.status === 'fulfilled' ? okRes.value : null,
      gaRes.status === 'fulfilled' ? gaRes.value : null,
    );
  });
}
