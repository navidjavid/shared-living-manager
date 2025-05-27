require('dotenv').config();
const { Pool } = require('pg');

const poolOptions = {
  connectionString: process.env.DATABASE_URL,
};
// SSL options as per your local setup
// if (process.env.LOCAL_DB_HAS_SSL === 'true') {
//   poolOptions.ssl = { rejectUnauthorized: false };
// }

const pool = new Pool(poolOptions);

const createTablesQuery = `
  CREATE TABLE IF NOT EXISTS people (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL, -- Display name
    chat_id TEXT,             -- Telegram chat_id, for sending messages
    telegram_user_id BIGINT UNIQUE -- Telegram user_id, for authentication
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    payer TEXT NOT NULL, -- Should reference people.name, but keep simple for now
    amount REAL NOT NULL,
    description TEXT,
    date DATE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS balances (
    person_from TEXT NOT NULL, -- Should reference people.name
    person_to TEXT NOT NULL,   -- Should reference people.name
    amount REAL NOT NULL,
    PRIMARY KEY (person_from, person_to),
    CHECK (person_from <> person_to)
  );
`;

async function initializeDatabase() {
  let client;
  try {
    client = await pool.connect();
    console.log('Connected to PostgreSQL database.');
    await client.query(createTablesQuery);
    console.log('✅ Database tables checked/created (people table now includes telegram_user_id).');
    await client.query('INSERT INTO rotation_state (id, "offset") VALUES (1, 0) ON CONFLICT (id) DO NOTHING;');
    console.log('✅ Rotation state initialized.');
    console.log('‼️ REMEMBER: Add people manually to the "people" table using pgAdmin, including their name and unique telegram_user_id.');
    console.log('Database initialization complete.');
  } catch (err) {
    console.error('❌ Error initializing database:', err.stack);
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

initializeDatabase();