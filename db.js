const mysql = require('mysql2');

let pool;

// Si estamos en Railway, usamos la "super-llave" DATABASE_URL
if (process.env.DATABASE_URL) {
    pool = mysql.createPool(process.env.DATABASE_URL);
} else {
    // Si estamos en tu compu, usamos las llaves locales
    pool = mysql.createPool({
        host: 'localhost',
        user: 'root',
        password: '16Di1983', // Tu contraseña local
        database: 'hotel_oasis_db',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
}

// Exportamos el "pool".
// Ya no necesitamos .connect(), el pool lo hace solo.
module.exports = pool;