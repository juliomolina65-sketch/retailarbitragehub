const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DIR = __dirname;

// ── Stripe Config ──────────────────────────────────────────
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) console.warn('Warning: STRIPE_SECRET_KEY not set in environment variables');
const stripe = require('stripe')(STRIPE_SECRET_KEY);

const PRO_PRICE_ID = process.env.PRO_PRICE_ID || 'price_1T5q3iH9I0r7YLxVlNV8VnNq';

// Dynamic base URL for return URLs
function getBaseUrl(req) {
  const host = req.headers.host || `localhost:${PORT}`;
  const proto = req.headers['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// ── Helper: read JSON body ─────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch(e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ── Helper: send JSON response ─────────────────────────────
function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  const method = req.method;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // ── API: Create Checkout Session (Pro Membership) ──────
  if (urlPath === '/api/create-checkout-session' && method === 'POST') {
    try {
      const body = await readBody(req);
      const session = await stripe.checkout.sessions.create({
        ui_mode: 'embedded',
        mode: 'subscription',
        line_items: [{ price: PRO_PRICE_ID, quantity: 1 }],
        customer_email: body.email || undefined,
        return_url: `${getBaseUrl(req)}?session_id={CHECKOUT_SESSION_ID}`,
      });
      json(res, 200, { clientSecret: session.client_secret });
    } catch (err) {
      console.error('Checkout error:', err.message);
      json(res, 500, { error: err.message });
    }
    return;
  }

  // ── API: Get Session Status ────────────────────────────
  if (urlPath === '/api/session-status' && method === 'GET') {
    try {
      const params = new URL(req.url, getBaseUrl(req)).searchParams;
      const sessionId = params.get('session_id');
      if (!sessionId) { json(res, 400, { error: 'Missing session_id' }); return; }
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['line_items', 'shipping_details'],
      });
      const result = {
        status: session.status,
        payment_status: session.payment_status,
        customer_email: session.customer_details?.email,
      };
      // Include order details for product purchases
      if (session.mode === 'payment') {
        result.shipping = session.shipping_details || null;
        result.items = (session.line_items?.data || []).map(li => ({
          name: li.description,
          qty: li.quantity,
          amount: li.amount_total / 100,
        }));
        result.total = session.amount_total / 100;
      }
      json(res, 200, result);
    } catch (err) {
      console.error('Session status error:', err.message);
      json(res, 500, { error: err.message });
    }
    return;
  }

  // ── API: Create Customer Portal Session ────────────────
  if (urlPath === '/api/create-portal-session' && method === 'POST') {
    try {
      const body = await readBody(req);
      // Find customer by email
      const customers = await stripe.customers.list({ email: body.email, limit: 1 });
      if (customers.data.length === 0) {
        json(res, 404, { error: 'No subscription found for this email' });
        return;
      }
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customers.data[0].id,
        return_url: getBaseUrl(req),
      });
      json(res, 200, { url: portalSession.url });
    } catch (err) {
      console.error('Portal error:', err.message);
      json(res, 500, { error: err.message });
    }
    return;
  }

  // ── API: Create Product Checkout Session ────────────────
  if (urlPath === '/api/create-product-checkout' && method === 'POST') {
    try {
      const body = await readBody(req);
      const items = body.items; // [{title, price, qty, image}]
      if (!items || !items.length) { json(res, 400, { error: 'No items' }); return; }

      const lineItems = items.map(item => ({
        price_data: {
          currency: 'usd',
          product_data: {
            name: item.title.substring(0, 200),
            ...(item.image ? { images: [item.image] } : {}),
          },
          unit_amount: Math.round(item.price * 100), // cents
        },
        quantity: item.qty || 1,
      }));

      const session = await stripe.checkout.sessions.create({
        ui_mode: 'embedded',
        mode: 'payment',
        line_items: lineItems,
        customer_email: body.email || undefined,
        shipping_address_collection: { allowed_countries: ['US'] },
        return_url: `${getBaseUrl(req)}?order_success=1&session_id={CHECKOUT_SESSION_ID}`,
      });
      json(res, 200, { clientSecret: session.client_secret });
    } catch (err) {
      console.error('Product checkout error:', err.message);
      json(res, 500, { error: err.message });
    }
    return;
  }

  // ── Static file serving ────────────────────────────────
  let filePath = path.join(DIR, urlPath === '/' ? 'index.html' : urlPath);
  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
