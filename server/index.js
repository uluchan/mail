import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import axios from 'axios';
import { google } from 'googleapis';
import fs from 'fs';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

// Google OAuth2 Setup
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI // Base redirect URI from env
);

const TOKEN_PATH = path.join(__dirname, 'tokens.json');

// Load tokens from file if exist
if (fs.existsSync(TOKEN_PATH)) {
    try {
        const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
        oauth2Client.setCredentials(tokens);
        console.log('Stored Google tokens loaded.');
    } catch (err) {
        console.error('Error loading tokens:', err);
    }
}

// Nodemailer fallback transporter
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_PORT === '465',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

const app = express();
app.use(cors());
app.use(express.json());

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    timezone: '+03:00' // Local timezone for Turkey
};

// Helper function to get connection with timezone set
async function getDbConnection() {
    const conn = await mysql.createConnection(dbConfig);
    await conn.execute("SET time_zone = '+03:00'");
    return conn;
}

// Check DB Connection
app.get('/api/db-status', async (req, res) => {
    try {
        // Try specific DB first
        const connection = await getDbConnection();
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
        const connection = await getDbConnection();
        console.log('Running database setup...');

        // Customers table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS customers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                company_name VARCHAR(255) NOT NULL,
                main_sector_id INT,
                sub_sector_id INT,
                email TEXT,
                website VARCHAR(255),
                city VARCHAR(100),
                district VARCHAR(100),
                phone VARCHAR(20),
                authorized_person VARCHAR(255),
                last_mail_at DATETIME,
                status VARCHAR(50) DEFAULT 'New Lead',
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE INDEX unique_website (website)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // Migration: Add ID columns if they don't exist
        try { await connection.execute('ALTER TABLE customers ADD COLUMN main_sector_id INT AFTER company_name'); } catch (e) { }
        try { await connection.execute('ALTER TABLE customers ADD COLUMN sub_sector_id INT AFTER main_sector_id'); } catch (e) { }
        try { await connection.execute('ALTER TABLE customers ADD COLUMN website VARCHAR(255) AFTER email'); } catch (e) { }
        try { await connection.execute('ALTER TABLE customers ADD COLUMN last_mail_at DATETIME AFTER authorized_person'); } catch (e) { }
        try { await connection.execute("ALTER TABLE customers ADD COLUMN status VARCHAR(50) DEFAULT 'New Lead' AFTER last_mail_at"); } catch (e) { }
        try { await connection.execute('ALTER TABLE customers ADD COLUMN notes TEXT AFTER status'); } catch (e) { }
        
        // Convert email to TEXT and remove old unique constraint
        try { await connection.execute('ALTER TABLE customers MODIFY COLUMN email TEXT'); } catch (e) { }
        try { await connection.execute('ALTER TABLE customers DROP INDEX unique_email'); } catch (e) { }
        try { await connection.execute('ALTER TABLE customers DROP INDEX email'); } catch (e) { }
        // Add unique index on website for duplicate prevention
        try { await connection.execute('ALTER TABLE customers ADD UNIQUE INDEX unique_website (website)'); } catch (e) { }

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
        const connection = await getDbConnection();
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
        const connection = await getDbConnection();
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
        const connection = await getDbConnection();
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
        const connection = await getDbConnection();
        await connection.execute('INSERT INTO main_sectors (name) VALUES (?)', [name]);
        await connection.end();
        res.json({ status: 'success' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/main-sectors/:id', async (req, res) => {
    try {
        const connection = await getDbConnection();
        await connection.execute('DELETE FROM main_sectors WHERE id = ?', [req.params.id]);
        await connection.end();
        res.json({ status: 'success' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/sub-sectors', async (req, res) => {
    try {
        const { main_sector_id, name, mail_subject, mail_template } = req.body;
        const connection = await getDbConnection();
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
        const connection = await getDbConnection();
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
        const connection = await getDbConnection();
        await connection.execute('DELETE FROM sub_sectors WHERE id = ?', [req.params.id]);
        await connection.end();
        res.json({ status: 'success' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Bulk Insert Sectors & Templates
app.post('/api/sectors/bulk', async (req, res) => {
    const items = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'Expected an array' });

    console.log(`[BulkSectors] Starting import of ${items.length} items...`);
    const connection = await getDbConnection();

    try {
        let updated = 0;
        let created = 0;

        for (const item of items) {
            const mainName = (item.main_sector || '').trim();
            const subName = (item.sub_sector || '').trim();
            const mailSubject = (item.mail_subject || '').trim();
            const mailTemplate = (item.mail_template || '').trim();

            if (!mainName || !subName) continue;

            // 1. Get or Create Main Sector
            let [mains] = await connection.execute('SELECT id FROM main_sectors WHERE LOWER(TRIM(name)) = LOWER(?)', [mainName]);
            let mainId;

            if (mains.length === 0) {
                console.log(`[BulkSectors] Creating Main Sector: "${mainName}"`);
                const [result] = await connection.execute('INSERT INTO main_sectors (name) VALUES (?)', [mainName]);
                mainId = result.insertId;
            } else {
                mainId = mains[0].id;
                // Update main sector name to match Excel exactly (fix capitalization/spaces)
                await connection.execute('UPDATE main_sectors SET name = ? WHERE id = ?', [mainName, mainId]);
            }

            // 2. Get, Create or Update Sub Sector
            let [subs] = await connection.execute(
                'SELECT id FROM sub_sectors WHERE main_sector_id = ? AND LOWER(TRIM(name)) = LOWER(?)',
                [mainId, subName]
            );

            if (subs.length > 0) {
                console.log(`[BulkSectors] Updating Sub Sector: "${subName}" under "${mainName}"`);
                await connection.execute(
                    'UPDATE sub_sectors SET name = ?, mail_subject = ?, mail_template = ? WHERE id = ?',
                    [subName, mailSubject, mailTemplate, subs[0].id]
                );
                updated++;
            } else {
                console.log(`[BulkSectors] Creating Sub Sector: "${subName}" under "${mainName}"`);
                await connection.execute(
                    'INSERT INTO sub_sectors (main_sector_id, name, mail_subject, mail_template) VALUES (?, ?, ?, ?)',
                    [mainId, subName, mailSubject, mailTemplate]
                );
                created++;
            }
        }

        console.log(`[BulkSectors] Finished. Updated: ${updated}, Created: ${created}`);
        res.json({ status: 'success', message: `${updated} sektör güncellendi, ${created} yeni sektör eklendi.` });
    } catch (error) {
        console.error('[BulkSectors] Error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        await connection.end();
    }
});

// Get all unique cities for filtering
app.get('/api/cities', async (req, res) => {
    try {
        const connection = await getDbConnection();
        const [rows] = await connection.execute('SELECT DISTINCT city FROM customers WHERE city IS NOT NULL AND city != "" ORDER BY city ASC');
        await connection.end();
        res.json(rows.map(r => r.city));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all customers (with pagination)
app.get('/api/customers', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { city, district, main_sector_id, sub_sector_id, search, company_name, email, website, status, notes } = req.query;

    try {
        const connection = await getDbConnection();

        let whereClauses = [];
        let params = [];

        if (city) {
            whereClauses.push("c.city LIKE ?");
            params.push(`%${city}%`);
        }
        if (district) {
            whereClauses.push("c.district LIKE ?");
            params.push(`%${district}%`);
        }
        if (main_sector_id) {
            whereClauses.push("c.main_sector_id = ?");
            params.push(main_sector_id);
        }
        if (sub_sector_id) {
            whereClauses.push("c.sub_sector_id = ?");
            params.push(sub_sector_id);
        }
        if (company_name) {
            whereClauses.push("c.company_name LIKE ?");
            params.push(`%${company_name}%`);
        }
        if (email) {
            whereClauses.push("c.email LIKE ?");
            params.push(`%${email}%`);
        }
        if (website) {
            whereClauses.push("c.website LIKE ?");
            params.push(`%${website}%`);
        }
        if (status) {
            whereClauses.push("c.status = ?");
            params.push(status);
        }
        if (notes) {
            whereClauses.push("c.notes LIKE ?");
            params.push(`%${notes}%`);
        }
        if (search) {
            whereClauses.push("(c.company_name LIKE ? OR c.email LIKE ? OR c.authorized_person LIKE ? OR c.city LIKE ? OR c.district LIKE ? OR c.website LIKE ?)");
            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam, searchParam, searchParam, searchParam, searchParam);
        }

        const whereSql = whereClauses.length > 0 ? "WHERE " + whereClauses.join(" AND ") : "";

        // Get total count for pagination with filters
        const [countResult] = await connection.execute(
            `SELECT COUNT(*) as total FROM customers c ${whereSql}`,
            params
        );
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
            ${whereSql}
            ORDER BY c.created_at DESC 
            LIMIT ? OFFSET ?
        `;

        // Add limit and offset to params for the actual data query
        const dataParams = [...params, limit.toString(), offset.toString()];
        const [rows] = await connection.execute(query, dataParams);

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

// Single Customer Management
app.post('/api/customers', async (req, res) => {
    try {
        const { company_name, main_sector_id, sub_sector_id, email, website, city, district, phone, authorized_person, last_mail_at, status, notes } = req.body;
        
        // Normalize website
        let normalizedWebsite = (website || '').trim().toLowerCase();
        if (normalizedWebsite.endsWith('/')) normalizedWebsite = normalizedWebsite.slice(0, -1);

        const connection = await getDbConnection();
        await connection.execute(
            `INSERT INTO customers (
                company_name, main_sector_id, sub_sector_id, email, website, city, district, phone, authorized_person, last_mail_at, status, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
                email = CASE 
                    WHEN email IS NULL OR email = '' THEN VALUES(email)
                    WHEN VALUES(email) IS NULL OR VALUES(email) = '' THEN email
                    ELSE CONCAT(email, ', ', VALUES(email))
                END,
                company_name = IF(company_name = 'İsimsiz Şirket' OR company_name IS NULL, VALUES(company_name), company_name)`,
            [company_name, main_sector_id, sub_sector_id, email, normalizedWebsite || null, city, district, phone, authorized_person, last_mail_at || null, status || 'New Lead', notes || null]
        );
        await connection.end();
        res.json({ status: 'success', message: 'Müşteri başarıyla eklendi veya mevcut kayıt güncellendi.' });
    } catch (error) {
        console.error('Insert Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/customers/:id', async (req, res) => {
    try {
        const { company_name, main_sector_id, sub_sector_id, email, website, city, district, phone, authorized_person, last_mail_at, status, notes } = req.body;
        const connection = await getDbConnection();
        await connection.execute(
            `UPDATE customers SET 
                company_name = ?, main_sector_id = ?, sub_sector_id = ?, 
                email = ?, website = ?, city = ?, district = ?, 
                phone = ?, authorized_person = ?, last_mail_at = ?,
                status = ?, notes = ?
            WHERE id = ?`,
            [
                company_name, main_sector_id, sub_sector_id, email, website, city, district, phone, authorized_person,
                last_mail_at || null, status || 'New Lead', notes || null, req.params.id
            ]
        );
        await connection.end();
        res.json({ status: 'success', message: 'Müşteri bilgileri güncellendi.' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Bu email adresi zaten başka bir müşteri tarafından kullanılıyor.' });
        }
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/customers/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        const connection = await getDbConnection();
        await connection.execute(
            'UPDATE customers SET status = ? WHERE id = ?',
            [status || 'New Lead', req.params.id]
        );
        await connection.end();
        res.json({ status: 'success', message: 'Müşteri durumu güncellendi.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Google Auth Endpoints
app.get('/api/auth/google/url', (req, res) => {
    const { redirectUri } = req.query;

    // Create a temporary client if redirectUri is provided to avoid changing global state
    const client = redirectUri ? new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        redirectUri
    ) : oauth2Client;

    const url = client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/gmail.settings.basic'
        ],
        prompt: 'consent', // Force refresh token
        state: redirectUri // Pass the redirectUri back via state
    });
    res.json({ url });
});

app.get('/api/auth/google/callback', async (req, res) => {
    const { code, state: redirectUriFromState } = req.query;
    try {
        if (!code) throw new Error('Auth code missing from callback.');

        // 1. Prioritize state (it should contain the exactly correct URI)
        // 2. Fallback to guestimates
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.headers['host'];
        const guessedUri = `${protocol}://${host}/api/auth/google/callback`;

        const possibleUris = [
            redirectUriFromState,
            guessedUri,
            process.env.GOOGLE_REDIRECT_URI,
            'http://localhost:3001/api/auth/google/callback'
        ].filter(Boolean);

        console.log(`[GoogleAuth] Callback with state: ${redirectUriFromState}. Guessed: ${guessedUri}`);

        let tokens = null;
        let lastError = null;

        for (const uri of possibleUris) {
            try {
                console.log(`[GoogleAuth] Attempting getToken with URI: ${uri}`);
                const tempClient = new google.auth.OAuth2(
                    process.env.GOOGLE_CLIENT_ID,
                    process.env.GOOGLE_CLIENT_SECRET,
                    uri
                );
                const { tokens: t } = await tempClient.getToken(code);
                tokens = t;
                console.log(`[GoogleAuth] Success with URI: ${uri}`);
                break;
            } catch (e) {
                console.error(`[GoogleAuth] Failed with URI: ${uri}. Error: ${e.message}`);
                lastError = e;
            }
        }

        if (!tokens) {
            throw new Error(`Token alınamadı. Son denenen hata: ${lastError?.message || 'Bilinmiyor'}`);
        }

        oauth2Client.setCredentials(tokens);
        
        // Note: On ephemeral environments like Vercel, this won't persist
        try {
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
        } catch (fsErr) {
            console.warn('[GoogleAuth] Token saved to memory but file save failed:', fsErr.message);
        }

        res.send('<h1>Başarıyla bağlandı!</h1><p>Şimdi uygulamaya geri dönebilirsiniz. Bu pencereyi kapatabilirsiniz.</p><script>window.close()</script>');
    } catch (error) {
        console.error('Callback error:', error);
        res.status(500).send(`Bağlantı sırasında hata oluştu: ${error.message}`);
    }
});

app.get('/api/auth/google/status', async (req, res) => {
    try {
        if (!oauth2Client.credentials || !oauth2Client.credentials.refresh_token) {
            return res.json({ authenticated: false });
        }

        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();
        res.json({ authenticated: true, email: userInfo.data.email });
    } catch (error) {
        res.json({ authenticated: false });
    }
});

app.post('/api/auth/google/logout', (req, res) => {
    try {
        oauth2Client.setCredentials({});
        if (fs.existsSync(TOKEN_PATH)) {
            fs.unlinkSync(TOKEN_PATH);
        }
        res.json({ status: 'success', message: 'Google oturumu kapatıldı.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Helper to get Gmail Sender Info (Signature & Display Name)
async function getGmailSenderInfo(auth) {
    try {
        const gmail = google.gmail({ version: 'v1', auth });
        const res = await gmail.users.settings.sendAs.list({ userId: 'me' });
        const primary = res.data.sendAs?.find(account => account.isPrimary);
        return {
            signature: primary?.signature || '',
            displayName: primary?.displayName || '',
            email: primary?.sendAsEmail || ''
        };
    } catch (err) {
        console.error('[GmailSenderInfo] Error fetching info:', err);
        return { signature: '', displayName: '', email: '' };
    }
}

// Real Email Sending Endpoint
app.post('/api/send-email', async (req, res) => {
    const { to, subject, html, customerId } = req.body;

    if (!to || !subject || !html) {
        return res.status(400).json({ error: 'Eksik bilgi: to, subject veya html gerekli.' });
    }

    try {
        let messageId;

        // Try Gmail API if authenticated
        if (oauth2Client.credentials && oauth2Client.credentials.refresh_token) {
            const senderInfo = await getGmailSenderInfo(oauth2Client);
            const fullHtml = senderInfo.signature ? `${html}<br><br>${senderInfo.signature}` : html;
            const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

            const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
            
            // Encode the display name too if it exists to handle Turkish characters
            const fromHeader = senderInfo.displayName 
                ? `=?utf-8?B?${Buffer.from(senderInfo.displayName).toString('base64')}?= <${senderInfo.email}>` 
                : senderInfo.email;

            const messageParts = [
                `From: ${fromHeader}`,
                `To: ${to}`,
                'Content-Type: text/html; charset=utf-8',
                'MIME-Version: 1.0',
                `Subject: ${utf8Subject}`,
                '',
                fullHtml,
            ];
            const message = messageParts.join('\n');
            const encodedMessage = Buffer.from(message)
                .toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');

            const response = await gmail.users.messages.send({
                userId: 'me',
                requestBody: { raw: encodedMessage },
            });
            messageId = response.data.id;
        } else {
            // Fallback to SMTP
            const info = await transporter.sendMail({
                from: process.env.SMTP_FROM,
                to,
                subject,
                html,
            });
            messageId = info.messageId;
        }

        console.log('Email sent: ' + messageId);

        // Update last_mail_at if customerId is provided
        if (customerId) {
            const connection = await getDbConnection();
            await connection.execute(
                'UPDATE customers SET last_mail_at = NOW() WHERE id = ?',
                [customerId]
            );
            await connection.end();
        }

        res.json({ status: 'success', message: 'E-posta başarıyla gönderildi.', messageId });
    } catch (error) {
        console.error('Email send error:', error);
        res.status(500).json({ error: 'E-posta gönderilemedi: ' + error.message });
    }
});

// Mark as Mail Sent (Legacy / Manual Marker)
app.post('/api/customers/:id/mail-sent', async (req, res) => {
    try {
        const connection = await getDbConnection();
        await connection.execute(
            'UPDATE customers SET last_mail_at = NOW() WHERE id = ?',
            [req.params.id]
        );
        await connection.end();
        res.json({ status: 'success', message: 'Mail gönderildi olarak işaretlendi.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/customers/:id', async (req, res) => {
    try {
        const connection = await getDbConnection();
        await connection.execute('DELETE FROM customers WHERE id = ?', [req.params.id]);
        await connection.end();
        res.json({ status: 'success', message: 'Müşteri silindi.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Bulk Insert Customers
app.post('/api/customers/bulk', async (req, res) => {
    const customers = req.body; // Expecting an array
    if (!Array.isArray(customers)) return res.status(400).json({ error: 'Expected an array' });

    try {
        const connection = await getDbConnection();

        // Use INSERT ... ON DUPLICATE KEY UPDATE to append emails
        const query = `
            INSERT INTO customers (
                company_name, main_sector_id, sub_sector_id, 
                main_sector, sector, email, website, 
                city, district, phone, authorized_person
            ) VALUES ?
            ON DUPLICATE KEY UPDATE 
                email = CASE 
                    WHEN email IS NULL OR email = '' THEN VALUES(email)
                    WHEN VALUES(email) IS NULL OR VALUES(email) = '' THEN email
                    ELSE CONCAT(email, ', ', VALUES(email))
                END,
                company_name = IF(company_name = 'İsimsiz Şirket' OR company_name IS NULL, VALUES(company_name), company_name)
        `;

        const values = customers.map(c => {
            let website = (c.website || '').trim().toLowerCase();
            if (website.endsWith('/')) website = website.slice(0, -1);
            
            return [
                c.company_name || 'İsimsiz Şirket',
                c.main_sector_id || null,
                c.sub_sector_id || null,
                c.main_sector || null,
                c.sector || null,
                c.email || null,
                website || null,
                c.city || null,
                c.district || null,
                c.phone || null,
                c.authorized_person || null
            ];
        });

        const [result] = await connection.query(query, [values]);
        await connection.end();

        // result.affectedRows in MySQL with ON DUPLICATE KEY UPDATE:
        // 1 for insert, 2 for update, 0 for no change
        res.json({
            status: 'success',
            message: `İşlem tamamlandı. Mükerrer web siteleri için e-postalar güncellendi.`
        });
    } catch (error) {
        console.error('Bulk Insert Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Clear all customers (Admin)
app.post('/api/customers/clear', async (req, res) => {
    const { password } = req.body;
    if (password !== 'sadesoda2023') {
        return res.status(401).json({ error: 'Geçersiz şifre.' });
    }

    try {
        const connection = await getDbConnection();
        await connection.execute('TRUNCATE TABLE customers');
        await connection.end();
        res.json({ status: 'success', message: 'Tüm müşteri listesi temizlendi.' });
    } catch (error) {
        console.error('Clear Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Migrate old text-based sector data to ID-based references
app.post('/api/customers/migrate-sectors', async (req, res) => {
    try {
        const connection = await getDbConnection();

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

        let url = company.website;
        if (!url.startsWith('http')) url = 'http://' + url;

        try {
            const response = await axios.get(url, {
                timeout: 8000, // Slightly longer timeout for deep check
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
                validateStatus: (status) => status < 400
            });

            const html = (response.data || '').toString().toLowerCase();
            const titleMatch = html.match(/<title>(.*?)<\/title>/);
            const title = titleMatch ? titleMatch[1].toLowerCase() : '';

            // Check for parked domain or default hosting pages
            const parkedKeywords = [
                'parked', 'domain for sale', 'buy this domain', 'hosting default page', 
                'plesk default', 'cpanel default', 'under construction', 'coming soon',
                'sedo', 'godaddy default', 'satılık alan adı', 'yakında hizmetinizde'
            ];

            const isParked = parkedKeywords.some(keyword => html.includes(keyword) || title.includes(keyword));
            
            // Check for very empty pages
            const isTooEmpty = html.length < 500;

            // Optional: More specific verification
            // Check if company name (partial) appears in title or content
            const simpleCompanyName = company.company_name.toLowerCase().split(' ')[0];
            const nameMentioned = html.includes(simpleCompanyName) || title.includes(simpleCompanyName);

            // 100% confidence logic: Status ok, not parked, has reasonable content length
            // We relaxed nameMentioned slightly because some companies have different brand names on web
            if (!isParked && !isTooEmpty) {
                return { ...company, website: url, isLive: true };
            }
            
            console.log(`Verification failed (Quality): ${url} - Parked: ${isParked}, TooEmpty: ${isTooEmpty}`);
            return { ...company, isLive: false };
        } catch (error) {
            console.log(`Verification failed (Connect): ${url} - ${error.code || error.message}`);
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
