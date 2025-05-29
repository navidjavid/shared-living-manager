// config/db.js
// Sets up the PostgreSQL connection pool and query helper.

const { Pool } = require('pg');
const { DATABASE_URL, DB_SSL_ENABLED, DB_SSL_REJECT_UNAUTHORIZED } = require('./envConfig');

const poolOptions = { 
    connectionString: DATABASE_URL,
    // Max 10 clients in the pool for Render free tier if it shares DB resources
    // For Supabase free tier, check their connection limits for the pooler/direct.
    max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX) : 10, 
    idleTimeoutMillis: process.env.DB_POOL_IDLE_TIMEOUT ? parseInt(process.env.DB_POOL_IDLE_TIMEOUT) : 30000,
    connectionTimeoutMillis: process.env.DB_POOL_CONNECTION_TIMEOUT ? parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT) : 2000,
};

if (DB_SSL_ENABLED) {
  poolOptions.ssl = {
    rejectUnauthorized: DB_SSL_REJECT_UNAUTHORIZED
  };
  console.log(`[DB_CONFIG] SSL for pg Pool IS CONFIGURED. rejectUnauthorized: ${poolOptions.ssl.rejectUnauthorized}`);
} else {
  console.log('[DB_CONFIG] SSL for pg Pool IS NOT configured.');
}

const pool = new Pool(poolOptions);

pool.on('error', (err, client) => {
  console.error('❌ Unexpected error on idle client in pg pool', err);
  // process.exit(-1); // Optional: exit if pool errors are critical
});

async function query(text, params) {
  const start = Date.now();
  let client; // Declare client here to ensure it's defined for release in finally
  try {
    client = await pool.connect();
    const res = await client.query(text, params);
    const duration = Date.now() - start;
    // console.log('[DB_QUERY] Executed query:', { text: text.substring(0, 50) + (text.length > 50 ? '...' : ''), duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('❌❌❌ [DB_QUERY_ERROR] Error during database query execution: ❌❌❌');
    console.error(`[DB_QUERY_ERROR] Query: ${text.substring(0, 200)}`);
    console.error(`[DB_QUERY_ERROR] Params: ${JSON.stringify(params)}`);
    console.error(`[DB_QUERY_ERROR] Error details:`, error.message);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

module.exports = { query, pool };