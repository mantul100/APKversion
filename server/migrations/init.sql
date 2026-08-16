-- init.sql: minimal schema for jagopos

-- Tenants & Users
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  username TEXT,
  email TEXT,
  role TEXT,
  password_hash TEXT,
  created_at TIMESTAMP DEFAULT now()
);

-- Products & Inventory
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  sku TEXT,
  name TEXT,
  price_retail BIGINT DEFAULT 0,
  price_grosir BIGINT DEFAULT 0,
  price_member BIGINT DEFAULT 0,
  price_cost BIGINT DEFAULT 0,
  is_weighted BOOLEAN DEFAULT false,
  barcode_prefix TEXT
);

CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  product_id UUID REFERENCES products(id),
  warehouse_id UUID,
  current_stock BIGINT DEFAULT 0,
  min_stock INT DEFAULT 0
);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  invoice_no TEXT,
  status TEXT,
  total_amount BIGINT,
  payment_method TEXT,
  created_by UUID,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transaction_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES transactions(id),
  product_id UUID,
  qty INT,
  unit_price BIGINT,
  modifier_text TEXT
);

-- Stock Mutations & Logs
CREATE TABLE IF NOT EXISTS stock_mutations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  product_id UUID,
  warehouse_from UUID,
  warehouse_to UUID,
  qty BIGINT,
  type TEXT,
  reference TEXT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  user_id UUID,
  action TEXT,
  meta JSONB,
  created_at TIMESTAMP DEFAULT now()
);

-- Shifts
CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  user_id UUID,
  opened_at TIMESTAMP,
  closed_at TIMESTAMP,
  expected_cash BIGINT DEFAULT 0,
  actual_cash BIGINT DEFAULT 0,
  status TEXT
);

-- Payment requests
CREATE TABLE IF NOT EXISTS payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES transactions(id),
  provider TEXT,
  reference TEXT,
  status TEXT,
  amount BIGINT,
  created_at TIMESTAMP DEFAULT now()
);
