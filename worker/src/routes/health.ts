import { corsHeaders } from '../lib/cors';

export function handleHealth(request: Request): Response {
  return new Response(
    JSON.stringify({
      status: 'ok',
      version: '1.0.0',
      ts: new Date().toISOString(),
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders(request),
      },
    },
  );
}
