const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'migrations', 'init.sql')).toString();
    const statements = sql.split(/;\s*\n/).filter(s=>s.trim());
    const client = await pool.connect();
    try {
      for (const st of statements) {
        await client.query(st);
      }
      console.log('Migrations executed');
    } finally { client.release(); }
  } catch (e) {
    console.error('Migration error', e);
    process.exit(1);
  } finally { process.exit(0); }
}

run();
