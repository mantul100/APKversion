// seed.js - creates minimal tenant, user, product, inventory for testing
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async function(){
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    const tenantRes = await client.query("INSERT INTO tenants (name) VALUES ($1) RETURNING id", ['Demo Toko']);
    const tenantId = tenantRes.rows[0].id;
    const userRes = await client.query("INSERT INTO users (tenant_id, username, email, role) VALUES ($1,$2,$3,$4) RETURNING id", [tenantId, 'kasir1', 'kasir@example.com', 'Kasir']);
    const productRes = await client.query("INSERT INTO products (tenant_id, sku, name, price_retail, price_grosir, price_member, price_cost, is_weighted, barcode_prefix) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id", [tenantId, 'SKU001', 'Kopi Latte 200ml', 15000, 12000, 13000, 8000, false, null]);
    const productId = productRes.rows[0].id;
    await client.query("INSERT INTO inventory (tenant_id, product_id, warehouse_id, current_stock, min_stock) VALUES ($1,$2,$3,$4,$5)", [tenantId, productId, uuidv4(), 10, 2]);
    // weighted product
    const prod2 = await client.query("INSERT INTO products (tenant_id, sku, name, price_retail, is_weighted, barcode_prefix) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [tenantId, 'WGT001', 'Apel Merah (per kg)', 40000, true, '22']);
    const prod2Id = prod2.rows[0].id;
    await client.query("INSERT INTO inventory (tenant_id, product_id, warehouse_id, current_stock, min_stock) VALUES ($1,$2,$3,$4,$5)", [tenantId, prod2Id, uuidv4(), 5000, 50]);
    await client.query('COMMIT');
    console.log('Seed data inserted. TenantId:', tenantId);
  } catch(e){ await client.query('ROLLBACK'); console.error('Seed failed', e);} finally{ client.release(); process.exit(0); }
})();
