import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, 'server', '.env') });

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
};

(async () => {
    try {
        const connection = await mysql.createConnection(dbConfig);

        console.log('--- Main Sectors ---');
        const [mains] = await connection.execute('SELECT * FROM main_sectors');
        console.log(JSON.stringify(mains, null, 2));

        console.log('\n--- Sub Sectors ---');
        const [subs] = await connection.execute('SELECT * FROM sub_sectors');
        console.log(JSON.stringify(subs, null, 2));

        console.log('\n--- Customer Count ---');
        const [counts] = await connection.execute('SELECT COUNT(*) as count FROM customers');
        console.log(counts);

        await connection.end();
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
