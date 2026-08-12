const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function setupDatabase() {
    console.log("Connecting to the LSA-Database...");

    const client = new Client({
        connectionString: "postgresql://postgres:data.jack@localhost:5432/LSA-Database"
    });

    try {
        await client.connect();
        console.log("Successfully connected to PostgreSQL!");

        const schemaPath = path.join(__dirname, 'database_schema.sql');
        console.log(`Reading SQL schema from ${schemaPath}...`);
        
        const sql = fs.readFileSync(schemaPath, 'utf8');
        
        console.log("Executing SQL schema (this may take a moment)...");
        await client.query(sql);
        
        console.log("✅ Success! Database tables, sequences, views, and triggers have been created successfully!");
    } catch (err) {
        console.error("❌ An error occurred during database setup:");
        console.error(err);
    } finally {
        await client.end();
        console.log("Database connection closed.");
    }
}

setupDatabase();
