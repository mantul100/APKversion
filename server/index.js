// server/index.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Health
app.get('/server/health', (req,res) => res.json({ ok:true }));

// Basic helper: determine price server-side
async function getProductPrice(client, productId, priceType){
  const r = await client.query('SELECT price_retail, price_grosir, price_member FROM products WHERE id = $1', [productId]);
  if (!r.rows.length) throw new Error('Produk tidak ditemukan');
  const p = r.rows[0];
  if (priceType === 'hargaGrosir') return p.price_grosir || p.price_retail;
  if (priceType === 'hargaMember') return p.price_member || p.price_retail;
  return p.price_retail;
}

// POST /server/checkout
app.post('/server/checkout', async (req,res) => {
  const { tenantId, cartItems, paymentMethod, kasir, priceType } = req.body;
  if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) return res.status(400).json({ status:'error', pesan:'Keranjang kosong' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // lock inventory rows involved
    const productIds = cartItems.map(c=>c.id);
    const q = await client.query('SELECT product_id, current_stock FROM inventory WHERE product_id = ANY($1) FOR UPDATE', [productIds]);
    // check stock per item
    for (const ci of cartItems) {
      const row = q.rows.find(r => r.product_id === ci.id);
      if (!row) { await client.query('ROLLBACK'); return res.status(409).json({ status:'error', pesan:'Produk tidak ditemukan di inventory' }); }
      if (Number(row.current_stock) < Number(ci.qty)) { await client.query('ROLLBACK'); return res.status(409).json({ status:'error', pesan:'Persediaan barang tidak mencukupi' }); }
    }
    // calculate totals using product prices
    let total = 0;
    const itemsToInsert = [];
    for (const ci of cartItems) {
      const unitPrice = await getProductPrice(client, ci.id, priceType || 'hargaUmum');
      // server authoritative modifiers: if frontend sent modifierText it's fine but price calc on server
      let extra = 0;
      if (ci.modifiers && Array.isArray(ci.modifiers)) { /* resolve modifier prices server-side if needed */ }
      const finalUnit = Number(unitPrice) + Number(extra);
      total += finalUnit * Number(ci.qty);
      itemsToInsert.push({ product_id: ci.id, qty: ci.qty, unit_price: finalUnit, modifier_text: ci.modifierText || '' });
    }
    // create transaction record
    const invoice = 'INV-' + Date.now();
    const txIns = await client.query('INSERT INTO transactions (tenant_id, invoice_no, status, total_amount, payment_method, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [tenantId||null, invoice, (paymentMethod==='Tunai' ? 'PAID' : 'PENDING'), total, paymentMethod, kasir||null]);
    const transactionId = txIns.rows[0].id;
    // deduct stock and insert items & mutations
    for (const it of itemsToInsert) {
      await client.query('UPDATE inventory SET current_stock = current_stock - $1 WHERE product_id = $2', [it.qty, it.product_id]);
      await client.query('INSERT INTO transaction_items (transaction_id, product_id, qty, unit_price, modifier_text) VALUES ($1,$2,$3,$4,$5)', [transactionId, it.product_id, it.qty, it.unit_price, it.modifier_text]);
      await client.query('INSERT INTO stock_mutations (tenant_id, product_id, qty, type, reference) VALUES ($1,$2,$3,$4,$5)', [tenantId||null, it.product_id, -Math.abs(it.qty), 'SALE', invoice]);
    }
    // If external payment required, create payment request record
    if (paymentMethod !== 'Tunai') {
      const payRef = 'PAY-' + uuidv4();
      await client.query('INSERT INTO payment_requests (transaction_id, provider, reference, status, amount) VALUES ($1,$2,$3,$4,$5)', [transactionId, paymentMethod, payRef, 'PENDING', total]);
      await client.query('COMMIT');
      return res.json({ status:'sukses', idTransaksi: transactionId, invoice_no: invoice, payment_reference: payRef, payment_url: 'https://mockpay.example/qr/' + payRef });
    }
    await client.query('COMMIT');
    return res.json({ status:'sukses', idTransaksi: transactionId, invoice_no: invoice });
  } catch (err) {
    console.error('checkout error', err);
    try { await client.query('ROLLBACK'); } catch(e){}
    return res.status(500).json({ status:'error', pesan: err.message });
  } finally { client.release(); }
});

// POST /server/sync/transactions - bulk processing of queued local transactions
app.post('/server/sync/transactions', async (req,res) => {
  const { items } = req.body; // items: [{ id: local_id, payload: { action, sheetId, data } }]
  if (!items || !items.length) return res.status(400).json({ status:'no_items' });
  const results = [];
  for (const it of items) {
    try {
      // only support prosesCheckout in this batch
      if (it.payload.action === 'prosesCheckout') {
        // call internal checkout flow
        // reuse existing endpoint logic by calling the function (simplified here)
        // For brevity, we'll call the same SQL flow inline (not ideal for DRY)
        const client = await pool.connect();
        await client.query('BEGIN');
        const cartItems = it.payload.data.keranjang;
        const productIds = cartItems.map(c=>c.id);
        const q = await client.query('SELECT product_id, current_stock FROM inventory WHERE product_id = ANY($1) FOR UPDATE', [productIds]);
        let conflict = false;
        for (const ci of cartItems) {
          const row = q.rows.find(r => r.product_id === ci.id);
          if (!row || Number(row.current_stock) < Number(ci.qty)) { conflict = true; break; }
        }
        if (conflict) { await client.query('ROLLBACK'); results.push({ local_id: it.id, status:'conflict', pesan:'Persediaan tidak mencukupi' }); client.release(); continue; }
        // compute total
        let total = 0; const itemsToInsert = [];
        for (const ci of cartItems) {
          const unitPrice = await getProductPrice(client, ci.id, 'hargaUmum');
          const finalUnit = Number(unitPrice);
          total += finalUnit * Number(ci.qty);
          itemsToInsert.push({ product_id: ci.id, qty: ci.qty, unit_price: finalUnit });
        }
        const invoice = 'INV-SYNC-' + Date.now();
        const txIns = await client.query('INSERT INTO transactions (tenant_id, invoice_no, status, total_amount, payment_method) VALUES ($1,$2,$3,$4,$5) RETURNING id', [null, invoice, 'PAID', total, 'OFFLINE_SYNC']);
        const transactionId = txIns.rows[0].id;
        for (const itx of itemsToInsert) {
          await client.query('UPDATE inventory SET current_stock = current_stock - $1 WHERE product_id = $2', [itx.qty, itx.product_id]);
          await client.query('INSERT INTO transaction_items (transaction_id, product_id, qty, unit_price) VALUES ($1,$2,$3,$4)', [transactionId, itx.product_id, itx.qty, itx.unit_price]);
          await client.query('INSERT INTO stock_mutations (tenant_id, product_id, qty, type, reference) VALUES ($1,$2,$3,$4,$5)', [null, itx.product_id, -Math.abs(itx.qty), 'SALE_OFFLINE', invoice]);
        }
        await client.query('COMMIT'); client.release();
        results.push({ local_id: it.id, status:'processed', transactionId, invoice });
      } else {
        results.push({ local_id: it.id, status:'unsupported' });
      }
    } catch (e) {
      console.error('sync item error', e);
      results.push({ local_id: it.id, status:'error', pesan: e.message });
    }
  }
  res.json({ items: results });
});

// POST /server/payment/webhook - mock gateway webhook
app.post('/server/payment/webhook', async (req,res) => {
  const { payment_reference, status } = req.body;
  if (!payment_reference) return res.status(400).json({ ok:false });
  try {
    const client = await pool.connect();
    const r = await client.query('SELECT * FROM payment_requests WHERE reference = $1', [payment_reference]);
    if (!r.rows.length) { client.release(); return res.status(404).json({ ok:false }); }
    const pr = r.rows[0];
    if (pr.status === 'PAID') { client.release(); return res.json({ ok:true, note:'already paid' }); }
    if (status === 'PAID') {
      await client.query('BEGIN');
      await client.query('UPDATE payment_requests SET status = $1 WHERE id = $2', ['PAID', pr.id]);
      await client.query('UPDATE transactions SET status = $1 WHERE id = $2', ['PAID', pr.transaction_id]);
      // post-payment tasks could go here
      await client.query('COMMIT');
      client.release();
      return res.json({ ok:true });
    }
    client.release();
    return res.json({ ok:true });
  } catch (e) {
    console.error('webhook err', e);
    return res.status(500).json({ ok:false });
  }
});

// Shift open/close skeletons
app.post('/server/shift/open', async (req,res) => {
  const { tenantId, userId, starting_cash } = req.body;
  try {
    const r = await pool.query('INSERT INTO shifts (tenant_id, user_id, opened_at, expected_cash, status) VALUES ($1,$2,now(),$3,$4) RETURNING id', [tenantId||null, userId||null, starting_cash||0, 'OPEN']);
    res.json({ status:'ok', shiftId: r.rows[0].id });
  } catch(e){ res.status(500).json({ status:'error', pesan:e.message }); }
});

app.post('/server/shift/close', async (req,res) => {
  const { shiftId, actual_cash } = req.body;
  try {
    const r = await pool.query('UPDATE shifts SET closed_at=now(), actual_cash=$1, status=$2 WHERE id=$3 RETURNING expected_cash, actual_cash', [actual_cash||0, 'CLOSED', shiftId]);
    if (!r.rows.length) return res.status(404).json({ status:'error', pesan:'Shift tidak ditemukan' });
    const expected = Number(r.rows[0].expected_cash||0);
    const actual = Number(r.rows[0].actual_cash||0);
    const diff = actual - expected;
    if (diff !== 0) {
      await pool.query('INSERT INTO audit_logs (tenant_id, user_id, action, meta) VALUES ($1,$2,$3,$4)', [null, null, 'shift_discrepancy', JSON.stringify({ shiftId, expected, actual, diff })]);
    }
    res.json({ status:'ok', diff });
  } catch(e){ res.status(500).json({ status:'error', pesan:e.message }); }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, ()=> console.log('Server listening on', PORT));
