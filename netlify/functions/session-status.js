const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const params = event.queryStringParameters || {};
    const sessionId = params.session_id;
    if (!sessionId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing session_id' }) };
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'shipping_details'],
    });

    const result = {
      status: session.status,
      payment_status: session.payment_status,
      customer_email: session.customer_details?.email,
    };

    if (session.mode === 'payment') {
      result.shipping = session.shipping_details || null;
      result.items = (session.line_items?.data || []).map(li => ({
        name: li.description,
        qty: li.quantity,
        amount: li.amount_total / 100,
      }));
      result.total = session.amount_total / 100;
    }

    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (err) {
    console.error('Session status error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
