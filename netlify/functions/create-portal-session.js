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
    const origin = event.headers.origin || event.headers.referer || process.env.URL || 'https://retailarbitragehub.netlify.app';
    const baseUrl = origin.replace(/\/$/, '');

    const customers = await stripe.customers.list({ email: body.email, limit: 1 });
    if (customers.data.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'No subscription found for this email' }) };
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customers.data[0].id,
      return_url: baseUrl,
    });

    return { statusCode: 200, headers, body: JSON.stringify({ url: portalSession.url }) };
  } catch (err) {
    console.error('Portal error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
