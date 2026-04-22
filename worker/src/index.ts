import { handleOptions, corsHeaders } from './lib/cors';
import { handleMarket } from './routes/market';
import { handleGlobal } from './routes/global';
import { handleLaunches } from './routes/launches';
import { handleExchanges } from './routes/exchanges';
import { handleFunding, handleLiquidations } from './routes/futures';
import { handleHealth } from './routes/health';

export interface Env {
  CG_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') return handleOptions(request);

    const { pathname } = new URL(request.url);

    try {
      switch (pathname) {
        case '/api/market':
          return await handleMarket(request, ctx, env);
        case '/api/global':
          return await handleGlobal(request, ctx, env);
        case '/api/launches':
          return await handleLaunches(request, ctx, env);
        case '/api/exchanges':
          return await handleExchanges(request, ctx);
        case '/api/futures/funding':
          return await handleFunding(request, ctx);
        case '/api/futures/liquidations':
          return await handleLiquidations(request, ctx);
        case '/api/health':
          return handleHealth(request);
        default:
          return new Response('Not found', { status: 404, headers: corsHeaders(request) });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Internal error';
      return new Response(JSON.stringify({ error: msg }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }
  },
};
