import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
app.use(cors());
app.use(express.json());

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
};

// Check DB Connection
app.get('/api/db-status', async (req, res) => {
    try {
        // Try specific DB first
        const connection = await mysql.createConnection(dbConfig);
        await connection.ping();
        await connection.end();
        res.json({ status: 'connected', message: `Successfully connected to database '${process.env.DB_NAME}'` });
    } catch (error) {
        if (error.code === 'ER_BAD_DB_ERROR') {
            try {
                // If DB doesn't exist, try connecting to the server in general
                const tempConfig = { ...dbConfig, database: undefined };
                const connection = await mysql.createConnection(tempConfig);
                const [rows] = await connection.execute('SHOW DATABASES');
                await connection.end();
                const dbs = rows.map(r => r.Database || r.database);
                res.json({
                    status: 'warning',
                    message: `Connected to MySQL, but database '${process.env.DB_NAME}' not found. Available: ${dbs.join(', ')}`
                });
                return;
            } catch (innerError) {
                console.error('General Connection Error:', innerError);
            }
        }
        console.error('DB Connection Error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Database Setup Function
async function setupDatabase() {
    try {
        const connection = await mysql.createConnection(dbConfig);
        console.log('Running database setup...');

        // Customers table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS customers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                company_name VARCHAR(255) NOT NULL,
                main_sector_id INT,
                sub_sector_id INT,
                email VARCHAR(255) UNIQUE,
                website VARCHAR(255),
                city VARCHAR(100),
                district VARCHAR(100),
                phone VARCHAR(20),
                authorized_person VARCHAR(255),
                last_mail_at DATETIME,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // Migration: Add ID columns if they don't exist
        try { await connection.execute('ALTER TABLE customers ADD COLUMN main_sector_id INT AFTER company_name'); } catch (e) { }
        try { await connection.execute('ALTER TABLE customers ADD COLUMN sub_sector_id INT AFTER main_sector_id'); } catch (e) { }
        try { await connection.execute('ALTER TABLE customers ADD COLUMN website VARCHAR(255) AFTER email'); } catch (e) { }
        try { await connection.execute('ALTER TABLE customers ADD COLUMN last_mail_at DATETIME AFTER authorized_person'); } catch (e) { }
        try { await connection.execute('ALTER TABLE customers ADD UNIQUE INDEX unique_email (email)'); } catch (e) { }

        // Optional: Remove old text columns if they exist (safer to keep for now or drop)
        // try { await connection.execute('ALTER TABLE customers DROP COLUMN main_sector'); } catch (e) { }
        // try { await connection.execute('ALTER TABLE customers DROP COLUMN sector'); } catch (e) { }

        // Main Sectors table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS main_sectors (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL UNIQUE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // Sub Sectors table (with Mail Template)
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS sub_sectors (
                id INT AUTO_INCREMENT PRIMARY KEY,
                main_sector_id INT,
                name VARCHAR(100) NOT NULL,
                mail_subject VARCHAR(255),
                mail_template TEXT,
                FOREIGN KEY (main_sector_id) REFERENCES main_sectors(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // Migration: Add mail_subject to sub_sectors
        try { await connection.execute('ALTER TABLE sub_sectors ADD COLUMN mail_subject VARCHAR(255) AFTER name'); } catch (e) { }

        await connection.end();
        console.log('Database setup complete.');
        return true;
    } catch (error) {
        console.error('Database setup error:', error);
        return false;
    }
}

app.post('/api/customers/:id/mail-sent', async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute(
            'UPDATE customers SET last_mail_at = NOW() WHERE id = ?',
            [req.params.id]
        );
        await connection.end();
        res.json({ status: 'success', last_mail_at: new Date() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Auto-migrate old text sector data to ID references
async function migrateLegacySectors() {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [toMigrate] = await connection.execute(
            'SELECT id, sector FROM customers WHERE sub_sector_id IS NULL AND sector IS NOT NULL'
        );
        let updated = 0;
        for (const customer of toMigrate) {
            const [subs] = await connection.execute(
                'SELECT ss.id as sub_id, ss.main_sector_id FROM sub_sectors ss WHERE LOWER(ss.name) = LOWER(?)',
                [customer.sector]
            );
            if (subs.length > 0) {
                const sub = subs[0];
                await connection.execute(
                    'UPDATE customers SET sub_sector_id = ?, main_sector_id = ? WHERE id = ?',
                    [sub.sub_id, sub.main_sector_id, customer.id]
                );
                updated++;
            }
        }
        await connection.end();
        if (updated > 0) console.log(`Legacy sector migration: ${updated} customers updated.`);
    } catch (e) {
        console.error('Legacy migration error:', e.message);
    }
}

// Initialize DB on Startup
async function initialize() {
    await setupDatabase();
    await migrateLegacySectors();
}
initialize();

// Setup Database Endpoint
app.get('/api/setup-database', async (req, res) => {
    const success = await setupDatabase();
    if (success) res.json({ status: 'success', message: 'Database schema updated' });
    else res.status(500).json({ status: 'error', message: 'Database setup failed' });
});

// Sector Management APIs
app.get('/api/sectors', async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [mains] = await connection.execute('SELECT * FROM main_sectors ORDER BY name');
        const [subs] = await connection.execute('SELECT * FROM sub_sectors ORDER BY name');
        await connection.end();

        const result = mains.map(m => ({
            ...m,
            sub_sectors: subs.filter(s => s.main_sector_id === m.id)
        }));

        res.json(result);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/main-sectors', async (req, res) => {
    try {
        const { name } = req.body;
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute('INSERT INTO main_sectors (name) VALUES (?)', [name]);
        await connection.end();
        res.json({ status: 'success' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/main-sectors/:id', async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute('DELETE FROM main_sectors WHERE id = ?', [req.params.id]);
        await connection.end();
        res.json({ status: 'success' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/sub-sectors', async (req, res) => {
    try {
        const { main_sector_id, name, mail_subject, mail_template } = req.body;
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute(
            'INSERT INTO sub_sectors (main_sector_id, name, mail_subject, mail_template) VALUES (?, ?, ?, ?)',
            [main_sector_id, name, mail_subject, mail_template]
        );
        await connection.end();
        res.json({ status: 'success' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/sub-sectors/:id', async (req, res) => {
    try {
        const { name, mail_subject, mail_template } = req.body;
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute(
            'UPDATE sub_sectors SET name = ?, mail_subject = ?, mail_template = ? WHERE id = ?',
            [name, mail_subject, mail_template, req.params.id]
        );
        await connection.end();
        res.json({ status: 'success' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/sub-sectors/:id', async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute('DELETE FROM sub_sectors WHERE id = ?', [req.params.id]);
        await connection.end();
        res.json({ status: 'success' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Bulk Insert Sectors & Templates
app.post('/api/sectors/bulk', async (req, res) => {
    const items = req.body; // Array of { main_sector, sub_sector, mail_template }
    if (!Array.isArray(items)) return res.status(400).json({ error: 'Expected an array' });

    try {
        const connection = await mysql.createConnection(dbConfig);

        for (const item of items) {
            if (!item.main_sector || !item.sub_sector) continue;

            // 1. Get or Create Main Sector
            let [mains] = await connection.execute('SELECT id FROM main_sectors WHERE name = ?', [item.main_sector]);
            let mainId;

            if (mains.length === 0) {
                const [result] = await connection.execute('INSERT INTO main_sectors (name) VALUES (?)', [item.main_sector]);
                mainId = result.insertId;
            } else {
                mainId = mains[0].id;
            }

            // 2. Get, Create or Update Sub Sector
            let [subs] = await connection.execute(
                'SELECT id FROM sub_sectors WHERE main_sector_id = ? AND name = ?',
                [mainId, item.sub_sector]
            );

            if (subs.length > 0) {
                // Update existing record with new template/subject
                await connection.execute(
                    'UPDATE sub_sectors SET mail_subject = ?, mail_template = ? WHERE id = ?',
                    [item.mail_subject || '', item.mail_template || '', subs[0].id]
                );
            } else {
                // Create new record
                await connection.execute(
                    'INSERT INTO sub_sectors (main_sector_id, name, mail_subject, mail_template) VALUES (?, ?, ?, ?)',
                    [mainId, item.sub_sector, item.mail_subject || '', item.mail_template || '']
                );
            }
        }

        await connection.end();
        res.json({ status: 'success', message: 'Bulk import complete' });
    } catch (error) {
        console.error('Bulk Sector Import Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all customers (with pagination)
app.get('/api/customers', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    try {
        const connection = await mysql.createConnection(dbConfig);

        // Get total count for pagination
        const [countResult] = await connection.execute('SELECT COUNT(*) as total FROM customers');
        const total = countResult[0].total;

        // Get paginated data with JOINs + fallback for legacy text data
        const query = `
            SELECT 
                c.*, 
                COALESCE(ms.name, c.main_sector) as main_sector_name, 
                COALESCE(ss.name, c.sector) as sub_sector_name 
            FROM customers c
            LEFT JOIN main_sectors ms ON c.main_sector_id = ms.id
            LEFT JOIN sub_sectors ss ON c.sub_sector_id = ss.id
            ORDER BY c.created_at DESC 
            LIMIT ? OFFSET ?
        `;
        const [rows] = await connection.execute(query, [limit.toString(), offset.toString()]);

        await connection.end();
        res.json({
            data: rows,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Bulk Insert Customers
app.post('/api/customers/bulk', async (req, res) => {
    const customers = req.body; // Expecting an array
    if (!Array.isArray(customers)) return res.status(400).json({ error: 'Expected an array' });

    try {
        const connection = await mysql.createConnection(dbConfig);

        // Use INSERT IGNORE to skip duplicates (requires UNIQUE constraint on email)
        const query = `
            INSERT IGNORE INTO customers (company_name, main_sector_id, sub_sector_id, email, website, city, district, phone, authorized_person)
            VALUES ?
        `;
        const values = customers.map(c => [
            c.company_name, c.main_sector_id, c.sub_sector_id, c.email, c.website, c.city, c.district, c.phone, c.authorized_person
        ]);

        const [result] = await connection.query(query, [values]);
        await connection.end();

        // Return how many were actually inserted (skipping duplicates)
        res.json({
            status: 'success',
            message: `${result.affectedRows} yeni müşteri eklendi, ${customers.length - result.affectedRows} mükerrer kayıt atlandı.`
        });
    } catch (error) {
        console.error('Bulk Insert Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Migrate old text-based sector data to ID-based references
app.post('/api/customers/migrate-sectors', async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);

        // Get all customers without sector IDs but with old text
        const [toMigrate] = await connection.execute(
            'SELECT id, sector FROM customers WHERE sub_sector_id IS NULL AND sector IS NOT NULL'
        );

        let updated = 0;
        for (const customer of toMigrate) {
            const [subs] = await connection.execute(
                'SELECT ss.id as sub_id, ss.main_sector_id FROM sub_sectors ss WHERE LOWER(ss.name) = LOWER(?)',
                [customer.sector]
            );
            if (subs.length > 0) {
                const sub = subs[0];
                await connection.execute(
                    'UPDATE customers SET sub_sector_id = ?, main_sector_id = ? WHERE id = ?',
                    [sub.sub_id, sub.main_sector_id, customer.id]
                );
                updated++;
            }
        }

        await connection.end();
        res.json({ status: 'success', message: `${updated} / ${toMigrate.length} müşteri güncellendi` });
    } catch (error) {
        console.error('Migration error:', error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3001;
// Verify Websites: Check if URLs are actually live
app.post('/api/verify-websites', async (req, res) => {
    const { companies } = req.body;
    if (!Array.isArray(companies)) return res.status(400).json({ error: 'Expected an array' });

    const verificationResults = await Promise.all(companies.map(async (company) => {
        if (!company.website) return { ...company, isLive: false };

        // Ensure URL has protocol
        let url = company.website;
        if (!url.startsWith('http')) url = 'http://' + url;

        try {
            // Fast check with HEAD or GET request and 5s timeout
            const response = await axios.get(url, {
                timeout: 5000,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
                validateStatus: (status) => status < 400 // Accept only 2xx or 3xx
            });
            return { ...company, website: url, isLive: true };
        } catch (error) {
            console.log(`Verification failed for ${url}: ${error.code || error.message}`);
            return { ...company, isLive: false };
        }
    }));

    // Return only companies that are confirmed live
    const liveCompanies = verificationResults.filter(c => c.isLive);
    res.json(liveCompanies);
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
