// config/db.js
const { Pool } = require('pg');
const { DATABASE_URL, DB_SSL_ENABLED, DB_SSL_REJECT_UNAUTHORIZED } = require('./envConfig');
const fs = require('fs');

const poolOptions = { 
    connectionString: DATABASE_URL,
    max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX) : 10,
    idleTimeoutMillis: process.env.DB_POOL_IDLE_TIMEOUT ? parseInt(process.env.DB_POOL_IDLE_TIMEOUT) : 30000,
    connectionTimeoutMillis: process.env.DB_POOL_CONNECTION_TIMEOUT ? parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT) : 2000,
};

if (DB_SSL_ENABLED) {
  poolOptions.ssl = {
    rejectUnauthorized: DB_SSL_REJECT_UNAUTHORIZED
    // Example for CA:
    // ca: fs.readFileSync(path.join(__dirname, '..', 'path/to/your/root.crt')).toString(),
  };
  console.log(`[DB_CONFIG] SSL for pg Pool configured. rejectUnauthorized: ${poolOptions.ssl.rejectUnauthorized}`);
} else {
  console.log('[DB_CONFIG] SSL for pg Pool not configured.');
}

const pool = new Pool(poolOptions);

pool.on('error', (err, client) => {
  console.error('❌ Unexpected error on idle client in pg pool', err);
});

async function query(text, params) {
  let client;
  try {
    client = await pool.connect();
    const res = await client.query(text, params);
    return res;
  } catch (error) {
    console.error('❌ [DB_QUERY_ERROR] Error during database query execution:');
    console.error(`[DB_QUERY_ERROR] Query (start): ${text.substring(0, 200)}...`);
    // Avoid logging params directly if they can contain sensitive data in production logs
    // console.error(`[DB_QUERY_ERROR] Params: ${JSON.stringify(params)}`); 
    console.error(`[DB_QUERY_ERROR] Error details:`, error.message);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

module.exports = { query, pool };