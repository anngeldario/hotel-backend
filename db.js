const mysql = require('mysql2');

let connection;

// Si estamos en Railway, usamos la "super-llave" DATABASE_URL
if (process.env.DATABASE_URL) {
    connection = mysql.createConnection(process.env.DATABASE_URL);
} else {
    // Si estamos en tu compu, usamos las llaves locales
    connection = mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '16Di1983', // Tu contraseña local
        database: 'hotel_oasis_db'
    });
}

connection.connect(error => {
    if (error) {
        console.error('Error al conectar a la base de datos:', error);
        return;
    }
    console.log('¡Conexión exitosa a la base de datos!');
});

module.exports = connection;