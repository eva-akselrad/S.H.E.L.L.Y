/**
 * Cloudflare Pages Function — handles GET /cs242 (Security Demo)
 * 
 * Checks CS242_DEMO_ENABLED env var before serving demo.html
 * Returns 404 if demo is disabled, respects password check
 */

export async function onRequest(context) {
    const { request, env } = context;
    
    const noCache = {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
    };
    
    const CS242_DEMO_ENABLED = (env.CS242_DEMO_ENABLED ?? 'true') !== 'false';
    const CS242_PASSWORD = env.CS242_PASSWORD || 'cs242-security';
    
    // Return 404 if demo is disabled — BEFORE any caching
    if (!CS242_DEMO_ENABLED) {
        return new Response('Not found', { 
            status: 404,
            headers: noCache 
        });
    }
    
    // Check password if demo is enabled
    const url = new URL(request.url);
    const providedPassword = url.searchParams.get('password') || '';
    
    if (providedPassword !== CS242_PASSWORD) {
        return new Response(JSON.stringify({ error: 'Access denied. Invalid or missing password.' }), {
            status: 403,
            headers: {
                'Content-Type': 'application/json',
                ...noCache
            }
        });
    }
    
    // Serve demo.html with no-cache headers
    const response = await context.next();
    const newResponse = new Response(response.body, response);
    
    // Override all cache headers
    newResponse.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    newResponse.headers.set('Pragma', 'no-cache');
    newResponse.headers.set('Expires', '0');
    
    return newResponse;
}
