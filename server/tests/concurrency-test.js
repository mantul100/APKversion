const fetch = require('node-fetch');
// concurrency-test.js - simulate concurrent checkout requests
// Ensure server and DB are running and seed data applied
(async function(){
  const SERVER = process.env.SERVER || 'http://localhost:4000';
  // sample payload: create two concurrent checkouts attempting to buy qty=10 of the same product (only 10 in stock)
  const productId = process.env.TEST_PRODUCT_ID || null;
  if (!productId) { console.error('Please set TEST_PRODUCT_ID env var to a product id from seed'); process.exit(1); }
  const payload = { tenantId: null, cartItems: [{ id: productId, qty: 10 }], paymentMethod: 'Tunai', kasir: 'test' };
  const calls = [];
  for (let i=0;i<3;i++) {
    calls.push(fetch(SERVER + '/server/checkout', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) }));
  }
  const results = await Promise.allSettled(calls);
  for (const r of results) {
    if (r.status === 'fulfilled') {
      const json = await r.value.json();
      console.log('Response:', json);
    } else {
      console.log('Request failed', r.reason);
    }
  }
  process.exit(0);
})();
