const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const items = body.items;
    if (!items || !items.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No items' }) };
    }

    const origin = event.headers.origin || event.headers.referer || process.env.URL || 'https://retailarbitragehub.netlify.app';
    const baseUrl = origin.replace(/\/$/, '');

    const lineItems = items.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.title.substring(0, 200),
          ...(item.image ? { images: [item.image] } : {}),
        },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: item.qty || 1,
    }));

    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded',
      mode: 'payment',
      line_items: lineItems,
      customer_email: body.email || undefined,
      shipping_address_collection: { allowed_countries: ['US'] },
      return_url: `${baseUrl}?order_success=1&session_id={CHECKOUT_SESSION_ID}`,
    });

    return { statusCode: 200, headers, body: JSON.stringify({ clientSecret: session.client_secret }) };
  } catch (err) {
    console.error('Product checkout error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
