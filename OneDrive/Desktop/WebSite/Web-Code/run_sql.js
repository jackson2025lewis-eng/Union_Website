const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const dbConfig = {
    connectionString: process.env.SUPABASE_DB_URL
};

async function run() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        await client.query('DROP TABLE IF EXISTS otp_logs;');
        
        const sql = fs.readFileSync(path.join(__dirname, 'database_schema.sql'), 'utf8');
        await client.query(sql);
        console.log("Schema applied successfully.");
    } catch (e) {
        console.error("Error applying schema:", e);
    } finally {
        await client.end();
    }
}

run();
