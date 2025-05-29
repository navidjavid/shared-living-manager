require('dotenv').config();
const { Pool } = require('pg');

const poolOptions = {
  connectionString: process.env.DATABASE_URL,
};

// === SSL Configuration for PostgreSQL === (adjust as per your Supabase/local setup)
if (process.env.DB_SSL_ENABLED === 'true') {
  poolOptions.ssl = {
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
  };
  console.log('[DEBUG] SSL for pg Pool IS CONFIGURED via init_db.js.');
} else {
  console.log('[DEBUG] SSL for pg Pool IS NOT configured via init_db.js.');
}

const pool = new Pool(poolOptions);

// Define the schema WITHOUT rotation_state
const createTablesQuery = `
  CREATE TABLE IF NOT EXISTS people (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,       -- This will be the username for login
    chat_id TEXT,
    telegram_user_id BIGINT UNIQUE,
    hashed_password TEXT,            -- To store the bcrypt hashed password
    is_admin BOOLEAN DEFAULT FALSE   -- Flag for admin panel access
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    payer TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT,
    date DATE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS balances (
    person_from TEXT NOT NULL, 
    person_to TEXT NOT NULL,
    amount REAL NOT NULL,
    PRIMARY KEY (person_from, person_to),
    CHECK (person_from <> person_to)
    -- Consider adding FOREIGN KEY constraints to people(name) here if names are guaranteed unique and stable
    -- FOREIGN KEY (person_from) REFERENCES people(name) ON DELETE CASCADE,
    -- FOREIGN KEY (person_to) REFERENCES people(name) ON DELETE CASCADE
  );
`;
// Note: The rotation_state table definition has been removed.

async function initializeDatabase() {
  let client;
  try {
    client = await pool.connect();
    console.log('Connected to PostgreSQL database.');
    await client.query(createTablesQuery);
    console.log('✅ Database tables checked/created (people table updated for admin login).');
    console.log('‼️ REMEMBER: For admin users, manually add/update their record in "people" table:');
    console.log('   - Set a hashed_password (see separate instructions for generating a hash).');
    console.log('   - Set is_admin = TRUE.');
    console.log('   - Ensure telegram_user_id is set if they also use the bot.');
    console.log('Database initialization complete.');
  } catch (err) {
    console.error('❌ Error initializing database:', err.stack);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

initializeDatabase();