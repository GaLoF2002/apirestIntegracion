const express = require('express');
const mysql = require('mysql2');
const xml2js = require('xml2js');
const axios = require('axios');

const app = express();
app.use(express.json()); // Para parsear el cuerpo de las solicitudes como JSON

// Configuración de la base de datos
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',  // Cambia esto con tu usuario de MySQL
    password: '1234',  // Cambia esto con tu contraseña de MySQL
    database: 'hotel_service'  // Cambia esto con tu base de datos
});

db.connect((err) => {
    if (err) {
        console.error('Error al conectar a la base de datos: ', err);
    } else {
        console.log('Conectado a la base de datos MySQL');
    }
});

// Endpoint para crear la reserva
app.post('/reservations', async (req, res) => {
    try {
        const { room_id, customer_name, start_date, end_date } = req.body;

        // Verificar disponibilidad de la habitación
        const isAvailable = await checkAvailability(start_date, end_date);

        if (!isAvailable) {
            return res.status(400).json({ message: 'No hay habitaciones disponibles en las fechas solicitadas.' });
        }

        // Registrar la reserva en la base de datos
        const query = 'INSERT INTO reservations (room_id, customer_name, start_date, end_date, status) VALUES (?, ?, ?, ?, ?)';
        db.query(query, [room_id, customer_name, start_date, end_date, 'pending'], (err, result) => {
            if (err) {
                return res.status(500).json({ message: 'Error al registrar la reserva en la base de datos', error: err });
            }
            return res.status(201).json({ message: 'Reserva creada con éxito', reservation_id: result.insertId });
        });
    } catch (error) {
        console.error('Error en la creación de la reserva:', error.message);
        res.status(500).json({ message: 'Error al procesar la reserva', error: error.message });
    }
});

// Función para verificar disponibilidad de habitaciones
async function checkAvailability(startDate, endDate) {
    try {
        // Consulta en la base de datos si hay habitaciones disponibles para el rango de fechas
        const query = `
            SELECT * FROM availability
            WHERE room_id NOT IN (
                SELECT room_id FROM reservations
                WHERE (start_date <= ? AND end_date >= ?)  -- Verifica solapamientos con el rango de fechas
            )
            AND available_date BETWEEN ? AND ?  -- Verifica que la habitación esté disponible dentro de las fechas
            AND status = 'available'  -- Solo habitaciones disponibles
        `;

        return new Promise((resolve, reject) => {
            db.query(query, [endDate, startDate, startDate, endDate], (err, result) => {
                if (err) {
                    console.error('Error al verificar disponibilidad en la base de datos:', err);
                    return reject(false);
                }

                if (result.length > 0) {
                    console.log('Habitación(s) disponible(s) en la base de datos:', result);
                    return resolve(true);  // Hay habitaciones disponibles
                } else {
                    console.log('No hay habitaciones disponibles en la base de datos.');
                    return resolve(false);  // No hay habitaciones disponibles
                }
            });
        });

    } catch (error) {
        console.error('Error al verificar disponibilidad en la base de datos:', error.message);
        return false;
    }
}

// Función para decodificar las entidades HTML (como &lt;, &gt;, etc.)
function decodeHtmlEntities(str) {
    return str.replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&');
}

// Función para parsear el XML a un objeto JavaScript
function parseXml(xml) {
    return new Promise((resolve, reject) => {
        xml2js.parseString(xml, { trim: true, explicitArray: false }, (err, result) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
}

// Ejemplo de la solicitud SOAP con datos
const soapRequest = `
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:tns="http://www.example.org/hotelavailability">
    <soap:Body>
        <tns:checkAvailability>
            <tns:roomType>single</tns:roomType>
            <tns:startDate>2024-12-20</tns:startDate>
            <tns:endDate>2024-12-22</tns:endDate>
        </tns:checkAvailability>
    </soap:Body>
</soap:Envelope>
`;

// Función para verificar la disponibilidad a través de SOAP (si se desea hacer)
async function checkAvailabilitySOAP() {
    try {
        const response = await axios.post('http://localhost:8000/soap', soapRequest, {
            headers: {
                'Content-Type': 'text/xml',
                'Accept': 'application/xml'
            }
        });

        console.log('Respuesta SOAP completa:', response.data);

        const soapResponse = response.data;
        const availableRoomsEscaped = extractAvailableRooms(soapResponse);

        if (availableRoomsEscaped) {
            const decodedXml = decodeHtmlEntities(availableRoomsEscaped);  // Decodificar entidades HTML
            console.log('XML decodificado:', decodedXml);

            const parsedXml = await parseXml(decodedXml);

            if (parsedXml && parsedXml['soap:Envelope'] && parsedXml['soap:Envelope']['soap:Body']) {
                const body = parsedXml['soap:Envelope']['soap:Body'][0];
                if (body && body['tns:checkAvailabilityResponse']) {
                    const rooms = body['tns:checkAvailabilityResponse'][0]['tns:availableRooms'][0]['tns:room'];

                    // Filtrar habitaciones disponibles que coincidan con el rango de fechas
                    const startDate = new Date('2024-12-20');
                    const endDate = new Date('2024-12-22');

                    const availableRoom = rooms.find(room => {
                        const roomAvailableDate = new Date(room['tns:available_date']); // Convertir la fecha del SOAP en Date
                        return roomAvailableDate >= startDate && roomAvailableDate <= endDate;
                    });

                    if (availableRoom) {
                        console.log('Habitación disponible:', availableRoom);
                        return true;  // Si se encuentra una habitación disponible
                    }
                }
            }
        }

        return false;  // No hay habitaciones disponibles
    } catch (error) {
        console.error('Error al hacer la solicitud SOAP:', error.message);
        return false;
    }
}

// Función para extraer la cadena de XML escapado desde la respuesta SOAP
function extractAvailableRooms(xmlResponse) {
    const match = xmlResponse.match(/<tns:availableRooms>(.*?)<\/tns:availableRooms>/s);
    return match ? match[1] : null;
}

app.listen(3000, () => {
    console.log('API REST escuchando en http://localhost:3000');
});
