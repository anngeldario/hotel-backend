const mysql = require('mysql2');

// Esta es la parte "inteligente"
// Busca las variables de Railway primero. Si no existen, usa las locales.
const connection = mysql.createConnection({
    host: process.env.MYSQLHOST || 'localhost',
    user: process.env.MYSQLUSER || 'root',
    // Asegúrate de que esta sea tu contraseña local de MySQL
    password: process.env.MYSQLPASSWORD || '16Di1983', 
    database: process.env.MYSQLDATABASE || 'hotel_oasis_db',
    port: process.env.MYSQLPORT || 3306 // Puerto local
});

connection.connect(error => {
    if (error) {
        console.error('Error al conectar a la base de datos:', error);
        return;
    }
    console.log('¡Conexión exitosa a la base de datos!');
});

module.exports = connection;