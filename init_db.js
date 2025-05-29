// init_db.js
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

// Define the schema, now including "user_sessions"
const createTablesQuery = `
  CREATE TABLE IF NOT EXISTS people (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    chat_id TEXT,
    telegram_user_id BIGINT UNIQUE,
    hashed_password TEXT,
    is_admin BOOLEAN DEFAULT FALSE
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
    -- Optional FOREIGN KEY constraints can be added here referencing people(name)
  );

  CREATE TABLE IF NOT EXISTS "user_sessions" (
    "sid" varchar NOT NULL COLLATE "default",
    "sess" json NOT NULL,
    "expire" timestamp(6) NOT NULL
  )
  WITH (OIDS=FALSE);

  ALTER TABLE "user_sessions" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;

  CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "user_sessions" ("expire");
`;
// Note: rotation_state table is removed.
// The "user_sessions" table DDL is a common one used by connect-pg-simple.

async function initializeDatabase() {
  let client;
  try {
    client = await pool.connect();
    console.log('Connected to PostgreSQL database.');
    
    // Split DDL statements if your pg version or setup has issues with multi-statement queries in one go.
    // For simplicity here, assuming it can handle them or you can split if needed.
    // However, ALTER TABLE and CREATE INDEX should ideally run after CREATE TABLE.
    // Let's run them sequentially.

    await client.query(`
      CREATE TABLE IF NOT EXISTS people (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        chat_id TEXT,
        telegram_user_id BIGINT UNIQUE,
        hashed_password TEXT,
        is_admin BOOLEAN DEFAULT FALSE
      );`);
    console.log('✅ Table "people" checked/created.');

    await client.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id SERIAL PRIMARY KEY,
        payer TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        date DATE NOT NULL
      );`);
    console.log('✅ Table "expenses" checked/created.');

    await client.query(`
      CREATE TABLE IF NOT EXISTS balances (
        person_from TEXT NOT NULL,
        person_to TEXT NOT NULL,
        amount REAL NOT NULL,
        PRIMARY KEY (person_from, person_to),
        CHECK (person_from <> person_to)
      );`);
    console.log('✅ Table "balances" checked/created.');

    // Create user_sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "user_sessions" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL WITH TIME ZONE 
      )
      WITH (OIDS=FALSE);`); // Added WITH TIME ZONE for expire, common best practice
    console.log('✅ Table "user_sessions" checked/created.');

    // Add primary key to user_sessions (if not exists - more complex to check, usually just run)
    // For simplicity, this might error if run twice, but initdb is often a one-time or idempotent script
    try {
        await client.query(`ALTER TABLE "user_sessions" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;`);
        console.log('✅ Primary key "session_pkey" on "user_sessions" ensured.');
    } catch (e) {
        if (e.message.includes('already exists') || e.code === '42P07' || e.code === '42710') { // 42P07: duplicate table (for constraint), 42710: duplicate object name
            console.log('✅ Primary key "session_pkey" on "user_sessions" likely already exists.');
        } else {
            throw e; // Re-throw other errors
        }
    }
    
    // Create index on user_sessions (if not exists)
    await client.query(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "user_sessions" ("expire");`);
    console.log('✅ Index "IDX_session_expire" on "user_sessions" checked/created.');

    console.log('‼️ REMEMBER: For admin users, manually add/update their record in "people" table.');
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