const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const db = require('./db.js');
const FacebookStrategy = require('passport-facebook').Strategy;
const bcrypt = require('bcryptjs');

const app = express();
const port = 4000;

// ---- MIDDLEWARE ----
app.use(cors());
app.use(express.json());
app.use(session({ secret: 'secreto_super_secreto', resave: false, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());

// ---- CONFIGURACIÓN DE PASSPORT ----
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

passport.use(new GoogleStrategy({
    // ¡IMPORTANTE! VUELVE A PEGAR TUS CREDENCIALES CORRECTAS AQUÍ
    clientID: '663221233013-nuneg2t42auu4ccptrdffnc1g1l2dpr1.apps.googleusercontent.com', // NO debe empezar con http://
    clientSecret: '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',
    callbackURL: "https://hotel-backend-production-ed93.up.railway.app/api/auth/google/callback"
},
    (accessToken, refreshToken, profile, done) => {
        const { id, name, emails } = profile;
        db.query('SELECT * FROM clientes WHERE google_id = ?', [id], (err, results) => {
            if (err) return done(err);
            if (results.length > 0) {
                return done(null, results[0]);
            } else {
                const nuevoCliente = { nombre: name.givenName, apellido: name.familyName, email: emails[0].value, google_id: id, contrasena: 'google-provided' };
                db.query('INSERT INTO clientes SET ?', nuevoCliente, (err, insertResult) => {
                    if (err) return done(err);
                    nuevoCliente.id_cliente = insertResult.insertId;
                    return done(null, nuevoCliente);
                });
            }
        });
    }
));

passport.use(new FacebookStrategy({
    clientID: '1324693822497118',
    clientSecret: '31872c795ec0ff8bcd496afee643eb7a',
    callbackURL: "https://hotel-backend-production-ed93.up.railway.app/api/auth/facebook/callback",
    profileFields: ['id', 'displayName', 'emails'] // Pedimos estos datos a Facebook
},
    function (accessToken, refreshToken, profile, done) {
        const facebookId = profile.id;
        const email = profile.emails ? profile.emails[0].value : null; // El email puede ser nulo
        const nombreCompleto = profile.displayName.split(' ');
        const nombre = nombreCompleto[0];
        const apellido = nombreCompleto.slice(1).join(' ');

        db.query('SELECT * FROM clientes WHERE facebook_id = ?', [facebookId], (err, results) => {
            if (err) { return done(err); }
            if (results.length > 0) {
                return done(null, results[0]);
            } else {
                const nuevoCliente = { nombre, apellido, email, facebook_id: facebookId, contrasena: 'facebook-provided' };
                db.query('INSERT INTO clientes SET ?', nuevoCliente, (err, insertResult) => {
                    if (err) { return done(err); }
                    nuevoCliente.id_cliente = insertResult.insertId;
                    return done(null, nuevoCliente);
                });
            }
        });
    }
));

// ---- ENDPOINTS DE AUTENTICACIÓN ----
app.get('/api/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// ---- CÓDIGO ARREGLADO (GOOGLE) ----
app.get('/api/auth/google/callback',
    passport.authenticate('google', {
        // Pon tu URL de Netlify aquí
        failureRedirect: 'https://TU-URL-DE-NETLIFY.netlify.app/login-cliente.html'
    }),
    (req, res) => {
        const payload = { id: req.user.id_cliente, nombre: req.user.nombre, apellido: req.user.apellido, email: req.user.email };
        const token = jwt.sign(payload, 'tu_llave_secreta_aqui', { expiresIn: '1h' });

        // ¡EL ARREGLO ESTÁ AQUÍ! Redirigimos al frontend con el token en la URL
        res.redirect(`https://TU-URL-DE-NETLIFY.netlify.app/perfil.html?token=${token}`);
    }
);

// --- RUTAS PARA AUTENTICACIÓN CON FACEBOOK ---
app.get('/api/auth/facebook',
    passport.authenticate('facebook', { scope: ['email'] })); // Pedimos permiso para el email

app.get('/api/auth/facebook/callback',
    passport.authenticate('facebook', { failureRedirect: '/login-cliente.html' }),
    function (req, res) {
        const payload = { id: req.user.id_cliente, nombre: req.user.nombre, apellido: req.user.apellido, email: req.user.email };
        const token = jwt.sign(payload, 'tu_llave_secreta_aqui', { expiresIn: '1h' });

        res.send(`
        <script>
            localStorage.setItem('authToken', '${token}');
            window.location.href = '/perfil.html';
        </script>
    `);
    });

// ---- ENDPOINTS DE CLIENTES ----
app.post('/api/clientes/login', (req, res) => {
    const { email, contrasena } = req.body;
    const consultaSQL = "SELECT * FROM clientes WHERE email = ?";

    db.query(consultaSQL, [email], (error, results) => {
        if (error || results.length === 0) {
            return res.status(401).json({ mensaje: 'Correo o contraseña inválidos' });
        }

        const cliente = results[0];

        // Comparamos la contraseña enviada con la encriptada en la BD
        bcrypt.compare(contrasena, cliente.contrasena, (err, esValida) => {
            if (err || !esValida) {
                return res.status(401).json({ mensaje: 'Correo o contraseña inválidos' });
            }

            // Si es válida, creamos el token como antes
            const payload = { id: cliente.id_cliente, nombre: cliente.nombre, apellido: cliente.apellido, email: cliente.email };
            const token = jwt.sign(payload, 'tu_llave_secreta_aqui', { expiresIn: '1h' });
            res.json({ mensaje: 'Login de cliente exitoso', token: token });
        });
    });
});

app.post('/api/clientes/registro', (req, res) => {
    const { nombre, apellido, email, telefono, contrasena } = req.body;
    if (!nombre || !email || !contrasena) return res.status(400).json({ mensaje: 'Faltan campos.' });

    db.query("SELECT email FROM clientes WHERE email = ?", [email], (error, results) => {
        if (results.length > 0) return res.status(409).json({ mensaje: 'El correo ya está registrado.' });

        bcrypt.hash(contrasena, 10, (err, hash) => {
            if (err) return res.status(500).json({ mensaje: 'Error al encriptar.' });

            const nuevoCliente = { nombre, apellido, email, telefono: telefono || null, contrasena: hash };
            db.query("INSERT INTO clientes SET ?", nuevoCliente, (error, result) => {
                if (error) return res.status(500).json({ mensaje: 'Error al registrar.' });

                // --- ESTA ES LA PARTE NUEVA ---
                // Después de registrar, creamos un token y lo enviamos.
                const idNuevoCliente = result.insertId;
                const payload = { id: idNuevoCliente, nombre, apellido, email };
                const token = jwt.sign(payload, 'tu_llave_secreta_aqui', { expiresIn: '1h' });

                res.status(201).json({ mensaje: 'Cliente registrado con éxito', token: token });
            });
        });
    });
});

app.get('/api/clientes/mis-reservas', (req, res) => {
    // 1. Extraemos el token del encabezado
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ mensaje: 'Acceso denegado. Se requiere token.' });
    }

    try {
        // 2. Verificamos el token con el secreto correcto
        const payload = jwt.verify(token, 'tu_llave_secreta_aqui');
        const idCliente = payload.id;

        // 3. Si el token es válido, buscamos las reservas de ese cliente
        const consultaSQL = `
            SELECT r.*, h.numero, th.nombre as tipo_nombre 
            FROM reservas r
            JOIN habitacion h ON r.id_habitacion = h.id_habitacion
            JOIN tipos_habitacion th ON h.id_tipo = th.id_tipo
            WHERE r.id_cliente = ? 
            ORDER BY r.fecha_inicio DESC;
        `;

        db.query(consultaSQL, [idCliente], (error, results) => {
            if (error) {
                return res.status(500).json({ mensaje: 'Error en el servidor al buscar reservas.' });
            }
            // 4. Enviamos la lista de reservas (puede ser una lista vacía)
            res.json(results);
        });
    } catch (error) {
        // 5. Si jwt.verify falla (token expirado, inválido, etc.), enviamos el error 403
        res.status(403).json({ mensaje: 'Token inválido o expirado. Por favor, inicia sesión de nuevo.' });
    }
});

// --- NUEVO ENDPOINT PARA ACTUALIZAR PERFIL DE CLIENTE ---
app.put('/api/clientes/perfil', (req, res) => {
    // 1. Verificamos el token para saber quién está haciendo la petición
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ mensaje: 'Acceso denegado. Token no proporcionado.' });
    }

    try {
        const payload = jwt.verify(token, 'tu_llave_secreta_aqui');
        const idCliente = payload.id;

        // 2. Obtenemos los nuevos datos del cuerpo de la petición
        const { nombre, apellido } = req.body;

        if (!nombre || !apellido) {
            return res.status(400).json({ mensaje: 'Nombre y apellido son requeridos.' });
        }

        // 3. Creamos la consulta SQL para actualizar los datos
        const consultaSQL = "UPDATE clientes SET nombre = ?, apellido = ? WHERE id_cliente = ?";

        db.query(consultaSQL, [nombre, apellido, idCliente], (error, results) => {
            if (error) {
                console.error("Error al actualizar el perfil:", error);
                return res.status(500).json({ mensaje: 'Error en el servidor al actualizar el perfil.' });
            }

            // Verificamos si se actualizó alguna fila
            if (results.affectedRows === 0) {
                return res.status(404).json({ mensaje: 'Usuario no encontrado.' });
            }

            // 4. Si todo sale bien, enviamos una respuesta de éxito
            res.json({ mensaje: 'Perfil actualizado exitosamente.' });
        });

    } catch (error) {
        res.status(403).json({ mensaje: 'Token inválido.' });
    }
});

// ---- ENDPOINTS DE HABITACIONES Y RESERVAS ----
app.get('/api/habitaciones', (req, res) => {
    const consultaSQL = `
        SELECT
            h.id_habitacion, h.numero,
            th.nombre AS tipo_nombre, th.max_personas, th.precio_base AS precio, th.descripcion,
            th.imagen_url  -- <<<--- ¡LA COMA VA AQUÍ!
        FROM habitacion h
        JOIN tipos_habitacion th ON h.id_tipo = th.id_tipo
        WHERE h.estado = 'Disponible';
    `;
    db.query(consultaSQL, (error, resultados) => {
        if (error) {
            console.error("Error al ejecutar la consulta de habitaciones:", error);
            return res.status(500).json({ mensaje: "Error en el servidor" }); // Enviar JSON en error
        }
        res.json(resultados);
    });
});


// Endpoint para BUSCAR habitaciones disponibles por fecha y huéspedes
app.get('/api/habitaciones/disponibles', (req, res) => {
    const { inicio, fin, huespedes } = req.query;
    if (!inicio || !fin || !huespedes) {
        return res.status(400).json({ mensaje: 'Faltan parámetros de búsqueda (inicio, fin, huespedes).' });
    }
    const numHuespedes = parseInt(huespedes, 10);
    const consultaSQL = `
        SELECT
            h.id_habitacion, h.numero, h.capacidad,
            th.nombre AS tipo_nombre, th.servicios, th.precio_base AS precio, th.descripcion,
            th.imagen_url  -- <<<--- ¡LA COMA VA AQUÍ!
        FROM habitacion h
        JOIN tipos_habitacion th ON h.id_tipo = th.id_tipo
        WHERE
            h.capacidad >= ? 
            AND h.capacidad <= ? + 2 
            AND h.id_habitacion NOT IN (
                SELECT id_habitacion FROM reservas
                WHERE (fecha_inicio < ? AND fecha_fin > ?) AND estado != 'Cancelada'
            )
            AND h.estado = 'Disponible';
    `;
    db.query(consultaSQL, [numHuespedes, numHuespedes, fin, inicio], (error, resultados) => {
        if (error) {
            console.error("Error al buscar disponibilidad:", error);
            return res.status(500).json({ mensaje: "Error en el servidor" }); // Enviar JSON en error
        }
        res.json(resultados);
    });
});

// Endpoint para obtener los detalles de UNA SOLA habitación por su ID
app.get('/api/habitaciones/:id', (req, res) => {
    const idHabitacion = req.params.id;
    const consultaSQL = `
        SELECT
            h.*, th.*, th.precio_base AS precio,
            th.imagen_url  -- <<<--- ¡LA COMA VA AQUÍ!
        FROM habitacion h
        JOIN tipos_habitacion th ON h.id_tipo = th.id_tipo
        WHERE h.id_habitacion = ?;
    `;
    db.query(consultaSQL, [idHabitacion], (error, resultados) => {
        if (error) {
            console.error("Error al obtener la habitación:", error);
            return res.status(500).json({ mensaje: "Error en el servidor" }); // Enviar JSON en error
        }
        if (resultados.length === 0) {
            return res.status(404).json({ mensaje: 'Habitación no encontrada.' });
        }
        res.json(resultados[0]);
    });
});

// REEMPLAZA LA RUTA DE RESERVAS ROTA CON ESTA:
app.post('/api/reservas', (req, res) => {
    const { id_habitacion, fecha_inicio, fecha_fin, num_huespedes, cliente } = req.body;

    // ¡ESTE ES EL CAMBIO!
    // 1. Pedimos un "vaso" (conexión) del "garrafón" (pool)
    db.getConnection((err, connection) => {
        if (err) return res.status(500).json({ mensaje: 'Error al conectar a la base de datos.' });

        // 2. Ahora sí, le decimos a ESE "vaso" que inicie la transacción
        connection.beginTransaction(err => {
            if (err) {
                connection.release(); // Soltamos el vaso
                return res.status(500).json({ mensaje: 'Error en servidor.' });
            }

            const checkAvailabilitySQL = `
                SELECT th.precio_base FROM habitacion h
                JOIN tipos_habitacion th ON h.id_tipo = th.id_tipo
                WHERE h.id_habitacion = ? AND h.id_habitacion NOT IN (
                    SELECT id_habitacion FROM reservas
                    WHERE (fecha_inicio < ? AND fecha_fin > ?) AND estado != 'Cancelada'
                ) FOR UPDATE;
            `;

            connection.query(checkAvailabilitySQL, [id_habitacion, fecha_fin, fecha_inicio], (err, results) => {
                if (err || results.length === 0) {
                    return connection.rollback(() => {
                        connection.release(); // Soltamos el vaso
                        res.status(409).json({ mensaje: 'Habitación no disponible.' });
                    });
                }

                const precioPorNoche = results[0].precio_base;

                const createReservation = (idCliente) => {
                    const codigoReserva = `RES-${Date.now()}`;
                    const datosReserva = {
                        codigo_reserva: codigoReserva,
                        id_cliente: idCliente,
                        id_habitacion, fecha_inicio, fecha_fin, num_huespedes,
                        precio_por_noche: precioPorNoche
                    };

                    connection.query("INSERT INTO reservas SET ?", datosReserva, (err, insertResult) => {
                        if (err) return connection.rollback(() => {
                            connection.release(); // Soltamos el vaso
                            res.status(500).json({ mensaje: 'Error al crear la reserva.' });
                        });

                        const idNuevaReserva = insertResult.insertId;
                        const historialData = {
                            id_reserva: idNuevaReserva,
                            estado_nuevo: 'Pendiente',
                            modificado_por: `Cliente ID: ${idCliente}`
                        };

                        connection.query("INSERT INTO historial_reservas SET ?", historialData, (err) => {
                            if (err) return connection.rollback(() => {
                                connection.release(); // Soltamos el vaso
                                res.status(500).json({ mensaje: 'Error al registrar historial.' });
                            });

                            // 3. Si todo salió bien, confirmamos y soltamos el vaso
                            connection.commit(err => {
                                if (err) return connection.rollback(() => {
                                    connection.release(); // Soltamos el vaso
                                    res.status(500).json({ mensaje: 'Error al confirmar.' });
                                });

                                connection.release(); // ¡Soltamos el vaso!
                                res.status(201).json({ mensaje: 'Reserva creada con éxito', codigo: codigoReserva });
                            });
                        });
                    });
                };

                connection.query("SELECT id_cliente FROM clientes WHERE email = ?", [cliente.email], (err, clientResults) => {
                    if (err) return connection.rollback(() => {
                        connection.release(); // Soltamos el vaso
                        res.status(500).json({ mensaje: 'Error al buscar cliente.' });
                    });

                    if (clientResults.length > 0) {
                        createReservation(clientResults[0].id_cliente);
                    } else {
                        bcrypt.hash('12345', 10, (err, hash) => {
                            const newClientData = { ...cliente, contrasena: hash };
                            connection.query("INSERT INTO clientes SET ?", newClientData, (err, resultInsert) => {
                                if (err) return connection.rollback(() => {
                                    connection.release(); // Soltamos el vaso
                                    res.status(500).json({ mensaje: 'Error al crear cliente.' });
                                });
                                createReservation(resultInsert.insertId);
                            });
                        });
                    }
                });
            });
        });
    });
});


app.get('/api/reservas/:codigo', (req, res) => {
    const codigoReserva = req.params.codigo;
    const consultaSQL = `
        SELECT 
            r.*, -- Traemos todas las columnas de la reserva, incluyendo precio_por_noche
            c.nombre, c.apellido, c.email, 
            h.numero, 
            th.nombre as tipo_nombre
        FROM reservas r
        JOIN clientes c ON r.id_cliente = c.id_cliente
        JOIN habitacion h ON r.id_habitacion = h.id_habitacion
        JOIN tipos_habitacion th ON h.id_tipo = th.id_tipo
        WHERE r.codigo_reserva = ?;
    `;
    db.query(consultaSQL, [codigoReserva], (error, results) => {
        if (error || results.length === 0) {
            return res.status(404).json({ mensaje: 'Reserva no encontrada' });
        }
        res.json(results[0]);
    });
});



// --- NUEVO ENDPOINT PARA CAMBIAR CONTRASEÑA ---
app.put('/api/clientes/cambiar-contrasena', (req, res) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ mensaje: 'Acceso denegado.' });

    try {
        const payload = jwt.verify(token, 'tu_llave_secreta_aqui');
        const idCliente = payload.id;
        const { contrasenaActual, nuevaContrasena } = req.body;

        // 1. Buscamos la contraseña actual (encriptada) del usuario
        db.query("SELECT contrasena FROM clientes WHERE id_cliente = ?", [idCliente], (err, results) => {
            if (err || results.length === 0) return res.status(404).json({ mensaje: 'Usuario no encontrado.' });

            const hashActual = results[0].contrasena;

            // 2. Comparamos la contraseña actual que nos envió con la de la BD
            bcrypt.compare(contrasenaActual, hashActual, (err, esValida) => {
                if (err || !esValida) {
                    return res.status(401).json({ mensaje: 'La contraseña actual es incorrecta.' });
                }

                // 3. Si es correcta, encriptamos la nueva contraseña
                bcrypt.hash(nuevaContrasena, 10, (err, nuevoHash) => {
                    if (err) return res.status(500).json({ mensaje: 'Error al encriptar la nueva contraseña.' });

                    // 4. Actualizamos la BD con la nueva contraseña encriptada
                    db.query("UPDATE clientes SET contrasena = ? WHERE id_cliente = ?", [nuevoHash, idCliente], (err, updateResult) => {
                        if (err) return res.status(500).json({ mensaje: 'Error al guardar la nueva contraseña.' });
                        res.json({ mensaje: 'Contraseña actualizada exitosamente.' });
                    });
                });
            });
        });
    } catch (error) {
        res.status(403).json({ mensaje: 'Token inválido.' });
    }
});


// ---- ENDPOINT PARA OBTENER TODAS LAS RESERVAS (ACCESIBLE PARA EMPLEADOS Y ADMIN) ----
app.get('/api/panel/reservas', verificarToken, (req, res) => { // <-- CAMBIAMOS LA RUTA Y EL GUARDIÁN
    const consultaSQL = `
        SELECT 
            r.codigo_reserva, c.nombre, c.apellido, r.fecha_inicio, r.fecha_fin,
            h.numero AS numero_habitacion, th.nombre AS tipo_habitacion, r.estado
        FROM reservas r
        JOIN clientes c ON r.id_cliente = c.id_cliente
        JOIN habitacion h ON r.id_habitacion = h.id_habitacion
        JOIN tipos_habitacion th ON h.id_tipo = th.id_tipo
        ORDER BY r.fecha_reserva DESC;
    `;
    db.query(consultaSQL, (error, results) => {
        if (error) {
            console.error("Error al obtener las reservas para el panel:", error);
            return res.status(500).json({ mensaje: 'Error en el servidor.' });
        }
        res.json(results);
    });
});


// ---- ENDPOINT PARA OBTENER LOS DETALLES DE UNA SOLA RESERVA ----
app.get('/api/panel/reservas/:codigo', verificarToken, (req, res) => {
    const { codigo } = req.params;
    const consultaSQL = `
        SELECT r.*, c.nombre, c.apellido, c.email, c.telefono, h.numero, th.nombre as tipo_habitacion
        FROM reservas r
        JOIN clientes c ON r.id_cliente = c.id_cliente
        JOIN habitacion h ON r.id_habitacion = h.id_habitacion
        JOIN tipos_habitacion th ON h.id_tipo = th.id_tipo
        WHERE r.codigo_reserva = ?;
    `;
    db.query(consultaSQL, [codigo], (error, results) => {
        if (error || results.length === 0) {
            return res.status(404).json({ mensaje: 'Reserva no encontrada.' });
        }
        res.json(results[0]);
    });
});


// ---- ENDPOINT PARA OBTENER EL ESTADO DE TODAS LAS HABITACIONES ----
app.get('/api/panel/habitaciones', verificarToken, (req, res) => {
    const consultaSQL = "SELECT id_habitacion, numero, estado, estado_limpieza FROM habitacion ORDER BY numero ASC";
    db.query(consultaSQL, (error, results) => {
        if (error) return res.status(500).json({ mensaje: 'Error al obtener las habitaciones.' });
        res.json(results);
    });
});

// ---- ENDPOINT PARA ACTUALIZAR EL ESTADO DE UNA HABITACIÓN (EJ. LIMPIEZA) ----
app.put('/api/panel/habitaciones/:id/estado', verificarToken, (req, res) => {
    const { id } = req.params;
    const { nuevoEstado, nuevoEstadoLimpieza } = req.body;

    // Construimos la consulta dinámicamente para solo actualizar los campos necesarios
    let fields = [];
    let queryParts = [];
    if (nuevoEstado) {
        queryParts.push("estado = ?");
        fields.push(nuevoEstado);
    }
    if (nuevoEstadoLimpieza) {
        queryParts.push("estado_limpieza = ?");
        fields.push(nuevoEstadoLimpieza);
    }

    if (queryParts.length === 0) {
        return res.status(400).json({ mensaje: "No se proporcionaron nuevos estados." });
    }

    const consultaSQL = `UPDATE habitacion SET ${queryParts.join(', ')} WHERE id_habitacion = ?`;
    fields.push(id);

    db.query(consultaSQL, fields, (error, result) => {
        if (error) return res.status(500).json({ mensaje: "Error al actualizar la habitación." });
        res.json({ mensaje: "Habitación actualizada con éxito." });
    });
});

// ---- ENDPOINT PARA ACTUALIZAR EL ESTADO DE UNA RESERVA ----
app.put('/api/panel/reservas/:codigo/estado', verificarToken, (req, res) => {
    const { codigo } = req.params;
    const { nuevoEstado } = req.body;
    const modificador = `${req.user.rol} ID: ${req.user.id}`; // "Administrador ID: 2"

    // 1. Obtener la reserva actual para loguear el estado anterior
    db.query("SELECT id_reserva, estado FROM reservas WHERE codigo_reserva = ?", [codigo], (err, old) => {
        if (err || old.length === 0) return res.status(404).json({ mensaje: "Reserva no encontrada." });

        const idReserva = old[0].id_reserva;
        const estadoAnterior = old[0].estado;

        // 2. Actualizar el estado de la reserva
        db.query("UPDATE reservas SET estado = ? WHERE id_reserva = ?", [nuevoEstado, idReserva], (err, result) => {
            if (err) return res.status(500).json({ mensaje: "Error al actualizar el estado." });

            // 3. Insertar en el historial
            const historial = { id_reserva: idReserva, estado_anterior: estadoAnterior, estado_nuevo: nuevoEstado, modificado_por: modificador };
            db.query("INSERT INTO historial_reservas SET ?", historial, (err) => {
                if (err) console.error("Error al guardar en historial:", err); // No detenemos el proceso si el historial falla
                res.json({ mensaje: "Estado de la reserva actualizado con éxito." });
            });
        });
    });
});

// ---- ENDPOINT DE LOGIN PARA ADMINISTRADORES ----
app.post('/api/admin/login', (req, res) => {
    const { correo, contrasena } = req.body;

    if (!correo || !contrasena) {
        return res.status(400).json({ mensaje: 'Correo y contraseña son requeridos.' });
    }

    const consultaSQL = "SELECT * FROM personal WHERE correo = ?";
    db.query(consultaSQL, [correo], (error, results) => {
        if (error || results.length === 0) {
            return res.status(401).json({ mensaje: 'Credenciales inválidas.' });
        }

        const personal = results[0];

        // Comparamos la contraseña enviada con la encriptada
        bcrypt.compare(contrasena, personal.contrasena, (err, esValida) => {
            if (err || !esValida) {
                return res.status(401).json({ mensaje: 'Credenciales inválidas.' });
            }

            // Si es válida, creamos el token con su rol (puesto)
            const payload = {
                id: personal.id_personal,
                nombre: personal.nombre,
                rol: personal.puesto // ¡Importante para el dashboard!
            };

            const token = jwt.sign(payload, 'tu_llave_secreta_aqui', { expiresIn: '8h' });

            res.json({ mensaje: 'Login de administrador exitoso', token: token });
        });
    });
});


// Middleware para verificar que el usuario esté logueado (cualquier rol)
function verificarToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ mensaje: 'Acceso denegado. Se requiere token.' });
    }
    try {
        const payload = jwt.verify(token, 'tu_llave_secreta_aqui');
        req.user = payload; // Adjuntamos los datos del usuario para uso futuro
        next(); // Si el token es válido, dejamos pasar
    } catch (error) {
        res.status(403).json({ mensaje: 'Token inválido o expirado.' });
    }
}

// (Asegúrate de tener esta función, si no, añádela)
function verificarAdmin(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ mensaje: 'Acceso denegado. Token no proporcionado.' });

    try {
        const payload = jwt.verify(token, 'tu_llave_secreta_aqui');
        req.user = payload; // Adjuntamos los datos del usuario a la petición

        // Si la ruta es específicamente de admin, verificamos el rol
        if (req.originalUrl.includes('/api/admin/') && payload.rol !== 'Administrador') {
            return res.status(403).json({ mensaje: 'Acceso denegado. Permisos insuficientes.' });
        }
        next();
    } catch (error) {
        res.status(403).json({ mensaje: 'Token inválido.' });
    }
}

// ---- ENDPOINT PARA EL DASHBOARD DEL EMPLEADO (VISTA BÁSICA) ----
app.get('/api/employee/dashboard-stats', verificarAdmin, (req, res) => {
    const query = `
        SELECT
            (SELECT COUNT(*) FROM habitacion WHERE estado = 'Disponible') AS habitacionesDisponibles,
            (SELECT COUNT(*) FROM reservas WHERE fecha_inicio = CURDATE() AND estado != 'Cancelada') AS llegadasHoy,
            (SELECT COUNT(*) FROM reservas WHERE fecha_fin = CURDATE() AND estado != 'Cancelada') AS salidasHoy
    `;
    db.query(query, (error, results) => {
        if (error) return res.status(500).json({ mensaje: 'Error al obtener estadísticas de empleado.' });
        res.json(results[0]);
    });
});


// ---- ENDPOINT PARA EL DASHBOARD DEL ADMINISTRADOR (VISTA COMPLETA) ----
app.get('/api/admin/dashboard-stats', verificarAdmin, (req, res) => {
    const statsQuery = `
        SELECT
            (SELECT COUNT(*) FROM reservas WHERE estado != 'Cancelada') AS totalReservas,
            (SELECT COUNT(*) FROM habitacion WHERE estado = 'Ocupada') AS habitacionesOcupadas,
            (SELECT COUNT(*) FROM habitacion WHERE estado != 'Mantenimiento') AS habitacionesActivas,
            (SELECT COUNT(*) FROM habitacion WHERE estado = 'Disponible') AS habitacionesDisponibles
    `;
    const actividadQuery = `
        SELECT r.codigo_reserva, c.nombre, c.apellido, h.numero AS numero_habitacion, r.fecha_inicio, r.fecha_fin, r.estado
        FROM reservas r JOIN clientes c ON r.id_cliente = c.id_cliente JOIN habitacion h ON r.id_habitacion = h.id_habitacion
        ORDER BY r.fecha_reserva DESC LIMIT 5;
    `;

    db.query(statsQuery, (err1, statsResults) => {
        if (err1) return res.status(500).json({ mensaje: 'Error al obtener estadísticas.' });
        db.query(actividadQuery, (err2, actividadResults) => {
            if (err2) return res.status(500).json({ mensaje: 'Error al obtener actividad reciente.' });

            const stats = statsResults[0];
            const tasaOcupacion = stats.habitacionesActivas > 0 ? ((stats.habitacionesOcupadas / stats.habitacionesActivas) * 100).toFixed(0) : 0;

            res.json({
                totalReservas: stats.totalReservas,
                tasaOcupacion: tasaOcupacion,
                habitacionesDisponibles: stats.habitacionesDisponibles,
                actividadReciente: actividadResults
            });
        });
    });
});


// ---- ENDPOINT PARA LOS DATOS DE LA GRÁFICA DE RESERVAS (SOLO ADMIN) ----
app.get('/api/admin/reservations-chart-data', verificarAdmin, (req, res) => {
    // Esta consulta cuenta las reservas de los últimos 6 meses y las agrupa por mes.
    const query = `
        SELECT 
            DATE_FORMAT(fecha_reserva, '%Y-%m') AS mes,
            COUNT(id_reserva) AS total
        FROM reservas
        WHERE fecha_reserva >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
        GROUP BY mes
        ORDER BY mes ASC;
    `;

    db.query(query, (error, results) => {
        if (error) {
            return res.status(500).json({ mensaje: 'Error al obtener datos para la gráfica.' });
        }

        // Formateamos los datos como los necesita Chart.js
        const labels = results.map(item => {
            const [year, month] = item.mes.split('-');
            // Convertimos '2025-10' a 'Oct'
            return new Date(year, month - 1).toLocaleString('es-MX', { month: 'short' });
        });
        const data = results.map(item => item.total);

        res.json({ labels, data });
    });
});



// ---- ENDPOINTS EXCLUSIVOS PARA ADMINISTRADOR ----

// 1. OBTENER TODO EL PERSONAL
app.get('/api/admin/personal', verificarAdmin, (req, res) => {
    // Excluimos la contraseña del resultado por seguridad
    const consultaSQL = "SELECT id_personal, nombre, apellido, puesto, correo, activo FROM personal ORDER BY nombre ASC";
    db.query(consultaSQL, (error, results) => {
        if (error) return res.status(500).json({ mensaje: 'Error al obtener el personal.' });
        res.json(results);
    });
});

// 2. DAR DE ALTA A UN NUEVO EMPLEADO
app.post('/api/admin/personal', verificarAdmin, (req, res) => {
    const { nombre, apellido, puesto, correo, contrasena } = req.body;
    if (!nombre || !correo || !contrasena || !puesto) {
        return res.status(400).json({ mensaje: 'Faltan campos obligatorios.' });
    }

    // Encriptamos la contraseña antes de guardarla
    bcrypt.hash(contrasena, 12, (err, hash) => {
        if (err) return res.status(500).json({ mensaje: 'Error al encriptar la contraseña.' });

        const nuevoEmpleado = { nombre, apellido, puesto, correo, contrasena: hash };
        db.query("INSERT INTO personal SET ?", nuevoEmpleado, (error, result) => {
            if (error) {
                if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ mensaje: 'El correo ya está registrado.' });
                return res.status(500).json({ mensaje: 'Error al registrar el empleado.' });
            }
            res.status(201).json({ mensaje: 'Empleado registrado con éxito.' });
        });
    });
});

// 3. OBTENER DATOS PARA REPORTES
app.get('/api/admin/reportes', verificarAdmin, (req, res) => {
    const { inicio, fin } = req.query;
    if (!inicio || !fin) {
        return res.status(400).json({ mensaje: 'Se requieren fechas de inicio y fin.' });
    }

    const diasDiferencia = (new Date(fin) - new Date(inicio)) / (1000 * 3600 * 24);

    let consultaSQL;
    let groupBy, labelFormat;

    // Lógica para agrupar automáticamente
    if (diasDiferencia <= 14) { // Menos de 2 semanas -> por día
        groupBy = 'd.dia';
        labelFormat = `DATE_FORMAT(d.dia, '%a %d/%b')`; // 'mié 15/Oct'
    } else if (diasDiferencia <= 90) { // Hasta 3 meses -> por semana
        groupBy = 'YEARWEEK(d.dia, 1)';
        labelFormat = `CONCAT('Semana del ', DATE_FORMAT(MIN(d.dia), '%d/%b'))`;
    } else { // Más de 3 meses -> por mes
        //  ========= LA CORRECCIÓN ESTÁ AQUÍ (USAMOS BACKTICKS) =========
        groupBy = `DATE_FORMAT(d.dia, '%Y-%m')`;
        //  ==============================================================
        labelFormat = `DATE_FORMAT(d.dia, '%M %Y')`; // 'Octubre 2025'
    }

    consultaSQL = `
        WITH RECURSIVE dates AS (
            SELECT DATE(?) as dia UNION ALL SELECT dia + INTERVAL 1 DAY FROM dates WHERE dia < DATE(?)
        )
        SELECT
            ${labelFormat} AS label,
            COALESCE(SUM(CASE WHEN r.fecha_inicio <= d.dia AND r.fecha_fin > d.dia THEN r.precio_por_noche ELSE 0 END), 0) as ingresos,
            COUNT(DISTINCT CASE WHEN r.fecha_inicio <= d.dia AND r.fecha_fin > d.dia AND r.estado IN ('Check-in', 'Confirmada') THEN r.id_habitacion END) as ocupadas,
            COUNT(DISTINCT d.dia) as dias_en_periodo
        FROM dates d
        LEFT JOIN reservas r ON d.dia >= r.fecha_inicio AND d.dia < r.fecha_fin AND r.estado IN ('Check-in', 'Confirmada')
        GROUP BY ${groupBy} ORDER BY MIN(d.dia) ASC;
    `;

    db.query(consultaSQL, [inicio, fin], (error, results) => {
        if (error) {
            console.error("Error al generar el reporte:", error);
            return res.status(500).json({ mensaje: 'Error al generar el reporte.' });
        }
        db.query("SELECT COUNT(*) as total FROM habitacion", (err, totalHabitaciones) => {
            if (err) return res.status(500).json({ mensaje: 'Error al obtener total de habitaciones.' });

            const total = totalHabitaciones[0].total;
            const reporte = results.map(row => ({
                label: row.label,
                ingresos: parseFloat(row.ingresos),
                tasaOcupacion: total > 0 ? (row.ocupadas / row.dias_en_periodo / total) * 100 : 0
            }));
            res.json({ reporte });
        });
    });
});


// 4. OBTENER LOS DATOS DE UN SOLO EMPLEADO PARA EDITARLOS
app.get('/api/admin/personal/:id', verificarAdmin, (req, res) => {
    const { id } = req.params;
    // Excluimos la contraseña por seguridad
    const consultaSQL = "SELECT id_personal, nombre, apellido, puesto, correo FROM personal WHERE id_personal = ?";
    db.query(consultaSQL, [id], (error, results) => {
        if (error || results.length === 0) {
            return res.status(404).json({ mensaje: 'Empleado no encontrado.' });
        }
        res.json(results[0]);
    });
});

// 5. ACTUALIZAR LOS DATOS DE UN EMPLEADO (EDITAR)
app.put('/api/admin/personal/:id', verificarAdmin, (req, res) => {
    const { id } = req.params;
    const { nombre, apellido, puesto, correo } = req.body;

    if (!nombre || !apellido || !puesto || !correo) {
        return res.status(400).json({ mensaje: 'Todos los campos son obligatorios.' });
    }

    const consultaSQL = "UPDATE personal SET nombre = ?, apellido = ?, puesto = ?, correo = ? WHERE id_personal = ?";
    db.query(consultaSQL, [nombre, apellido, puesto, correo, id], (error, result) => {
        if (error) {
            return res.status(500).json({ mensaje: 'Error al actualizar el empleado.' });
        }
        res.json({ mensaje: 'Empleado actualizado con éxito.' });
    });
});

// 6. DAR DE BAJA A UN EMPLEADO (DESACTIVAR)
app.delete('/api/admin/personal/:id', verificarAdmin, (req, res) => {
    const { id } = req.params;
    // Hacemos un "soft delete": en lugar de borrarlo, lo desactivamos.
    // Es una mejor práctica por si se necesita reactivar en el futuro.
    const consultaSQL = "UPDATE personal SET activo = 0 WHERE id_personal = ?";
    db.query(consultaSQL, [id], (error, result) => {
        if (error) {
            return res.status(500).json({ mensaje: 'Error al dar de baja al empleado.' });
        }
        res.json({ mensaje: 'Empleado dado de baja con éxito.' });
    });
});


// 7. CAMBIAR LA CONTRASEÑA DE UN EMPLEADO (SOLO ADMIN)
app.put('/api/admin/personal/:id/password', verificarAdmin, (req, res) => {
    const { id } = req.params;
    const { nuevaContrasena } = req.body;

    if (!nuevaContrasena) {
        return res.status(400).json({ mensaje: 'Se requiere la nueva contraseña.' });
    }

    // Encriptamos la nueva contraseña con bcrypt
    bcrypt.hash(nuevaContrasena, 12, (err, hash) => {
        if (err) {
            return res.status(500).json({ mensaje: 'Error al encriptar la contraseña.' });
        }

        // Actualizamos la base de datos con la nueva contraseña encriptada
        const consultaSQL = "UPDATE personal SET contrasena = ? WHERE id_personal = ?";
        db.query(consultaSQL, [hash, id], (error, result) => {
            if (error) {
                return res.status(500).json({ mensaje: 'Error al actualizar la contraseña.' });
            }
            res.json({ mensaje: 'Contraseña actualizada con éxito.' });
        });
    });
});


// ---- INICIAR SERVIDOR ----
app.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
});