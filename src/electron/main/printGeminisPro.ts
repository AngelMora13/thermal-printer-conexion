const SerialPort = require('serialport');
// Interfaces para la estandarización de datos y configuración
interface FacturaItem {
    descripcion: string; // Máx. 20 caracteres [cite: 638]
    cantidad: string;    // Formato nnnn.nnn [cite: 638]
    montoItem: string;   // Monto del ítem (sin impuesto), formato nnnnnn.nn [cite: 621, 638]
    tasaImpositiva: string; // Tasa imponible (e.g., .nnnn o '0001' para Percibido) [cite: 638]
    calificador: 'M' | 'm'; // 'M' = monto agregado (suma), 'm' = anulación de ítem [cite: 638]
}

interface DatosCliente {
    razonSocial: string; // Máx. 38 caracteres [cite: 574]
    rif: string;         // Máx. 12 caracteres [cite: 574]
}

// Configuración de la comunicación serial
const COM_PORT = 'COM4'; // Reemplazar con el puerto serial real
const BAUD_RATE = 9600; // Velocidad de comunicación [cite: 259, 1231]
const SEPARADOR_CAMPO = '\x1C'; // $0\times 1C$
const STX = '\x02'; // Inicio de texto $0\times 02$ [cite: 268]
const ETX = '\x03'; // Fin de texto $0\times 03$ [cite: 268]

// Datos Estáticos para la Factura Fiscal (a modificar por el desarrollador)
const DATOS_CLIENTE: DatosCliente = {
    razonSocial: 'CLIENTE OCASIONAL',
    rif: 'V000000000',
};

const ITEMS_FACTURA: FacturaItem[] = [
    {
        descripcion: 'Producto A',
        cantidad: '1.000',
        montoItem: '1000.00',
        tasaImpositiva: '0.1600', // Ejemplo: 16% IVA
        calificador: 'M',
    },
    {
        descripcion: 'Producto B',
        cantidad: '2.500',
        montoItem: '50.00',
        tasaImpositiva: '0.0000', // Ejemplo: Exento
        calificador: 'M',
    },
];

let SECUENCIA = 0x20; // Inicializar número de secuencia en $0\times 20$ [cite: 271]

/**
 * Calcula el Block Check Character (BCC) como la suma simple de los valores ASCII/Hex de todos
 * los caracteres desde STX hasta ETX, representado por 4 caracteres hexadecimales.
 * @param trama La trama de datos incluyendo STX y ETX.
 * @returns El BCC en formato de 4 caracteres hexadecimales.
 */
function calcularBCC(trama: string): string {
    let sum = 0;
    for (let i = 0; i < trama.length; i++) {
        sum += trama.charCodeAt(i);
    }
    // Convertir a hexadecimal, asegurar 4 dígitos y convertir a caracteres ASCII de dígitos/letras.
    // Ejemplo: 0x05D9 -> '0', '5', 'D', '9' (ASCII 30 35 44 39)
    const hexBCC = sum.toString(16).toUpperCase().padStart(4, '0');
    // Mapear los caracteres hexadecimales a sus valores ASCII (ej: '0' es $0\times 30$, 'A' es $0\times 41$).
    let bccString = '';
    for (const char of hexBCC) {
        if (char >= '0' && char <= '9') {
            bccString += String.fromCharCode(char.charCodeAt(0));
        } else { // 'A' a 'F'
            bccString += String.fromCharCode(char.charCodeAt(0));
        }
    }
    return bccString;
}

/**
 * Construye la trama completa del comando fiscal.
 * @param comandoHex El comando hexadecimal (e.g., '40').
 * @param campos Los campos de datos separados por el separador de campo.
 * @returns La trama completa del comando.
 */
function construirComando(comandoHex: string, campos: string[]): string {
    const secuenciaChar = String.fromCharCode(SECUENCIA); // Número de secuencia: $0\times 20$ a $0\times 7F$ [cite: 271]
    const comandoChar = String.fromCharCode(parseInt(comandoHex, 16));
    
    // Trama = STX + Sec + Comando + Separador + Campo1 + Separador + ... + ETX
    // Los campos ya deben incluir el separador de campo al final.
    const cuerpoComando = secuenciaChar + comandoChar + SEPARADOR_CAMPO + campos.join(SEPARADOR_CAMPO);
    const trama = STX + cuerpoComando + ETX;
    const bcc = calcularBCC(trama);

    // Incrementar el número de secuencia para el próximo comando.
    SECUENCIA = (SECUENCIA === 0x7F) ? 0x20 : SECUENCIA + 1;

    return trama + bcc;
}

/**
 * Verifica si la respuesta de la impresora fiscal indica un error.
 * @param respuesta La respuesta de la impresora.
 * @returns True si la respuesta contiene el string "ERROR", False en caso contrario.
 */
function verificarError(respuesta: string): boolean {
    if (respuesta.includes('ERROR')) {
        console.error('⚠️ Error en la respuesta del equipo fiscal:');
        console.error(respuesta);
        // El formato de error incluye 'ERROR' + Número de error [cite: 309]
        return true;
    }
    return false;
}
/**
 * Envía la secuencia de caracteres de control para forzar un RESET (reinicio por software) 
 * del controlador fiscal. Esto cancela cualquier documento fiscal abierto.
 * @param port El puerto serial abierto.
 * @returns Una promesa que resuelve cuando la secuencia es enviada.
 */
function forzarReset(port: any): Promise<void> {
    console.warn('\n⚠️ Forzando RESET del controlador fiscal (secuencia de caracteres de control)...');
    
    // La secuencia de reset es $0\times 07$ a $0\times 17$ (decimal 7 a 23) 
    const RESET_SEQUENCE = Buffer.from([
        0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 
        0x0F, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17
    ]);

    return new Promise((resolve, reject) => {
        // No es necesario STX, ETX o BCC para esta secuencia[cite: 326].
        port.write(RESET_SEQUENCE, (err: Error) => {
            if (err) {
                console.error('❌ Error al enviar la secuencia de RESET:', err.message);
                reject(err);
            } else {
                console.log('✅ Secuencia de RESET enviada. Espere unos segundos a que la impresora se reinicie.');
                // Espera para permitir que la impresora se reinicie y se libere.
                setTimeout(resolve, 3000); 
            }
        });
    });
}
/**
 * Intenta enviar el comando para cerrar/abortar la factura fiscal pendiente (0x45).
 * Esto es crucial si la impresión falló después de abrir el documento (0x40) y antes de cerrarlo (0x45).
 * @param port El puerto serial abierto.
 */
async function abortarDocumentoPendiente(port: any): Promise<void> {
    console.warn('\n⚠️ Intentando ABORTAR/CERRAR el documento fiscal pendiente (0x45) debido a un error...');
    
    // Comando 0x45: Cerrar Factura Fiscal
    const camposCerrar: string[] = [
        'T', // Calificador 'T' (Terminate/Cerrar). Usamos el cierre normal para liberar la impresora.
        '0.00' // Monto del pago en Divisa
    ];
    const comandoCerrar = construirComando('45', camposCerrar);

    try {
        // Enviar el comando de cierre y esperar la respuesta.
        const respuestaAborto = await enviarComando(port, comandoCerrar);
        
        // No verificamos error con verificarError() intencionalmente. Si falla el cierre/aborto, 
        // simplemente registramos el error de la impresora, pero no lanzamos una nueva excepción.
        if (respuestaAborto.includes('ERROR')) {
            console.error('❌ La impresora no pudo cerrar/abortar el documento pendiente. Revisar estado fiscal.');
        } else {
            console.log('✅ Documento fiscal pendiente cerrado/abortado con éxito.');
        }
    } catch (error) {
        // Capturar errores de comunicación durante el aborto
        console.error('❌ Error de comunicación al intentar cerrar/abortar la factura:', error);
        await forzarReset(port);
    }
}

/**
 * Función principal para imprimir una Factura Fiscal.
 * @returns Una promesa que resuelve a true si la impresión es exitosa, false en caso contrario.
 */
async function imprimirFacturaFiscal(): Promise<boolean> {
    console.log('Iniciando proceso de impresión de factura fiscal...');
    //verificar si es SerialPort.SerialPort o new SerialPort('COM3', { baudRate: 9600 });
    const port = new SerialPort.SerialPort({
        path: COM_PORT,
        baudRate: BAUD_RATE,
        autoOpen: false,
    });
    
    // Crear el parser para leer las respuestas línea por línea
    // Nota: El protocolo usa STX/ETX como delimitadores, pero para simplificar la lectura de la respuesta
    // que es una trama completa, usamos un evento 'data' simple o un parser más avanzado.
    // Usaremos una promesa para manejar la comunicación de solicitud/respuesta.
    
    port.open((err: any) => {
        if (err) {
            console.error('❌ Error al abrir el puerto serial:', err.message);
            return;
        }
        console.log('✅ Puerto serial abierto exitosamente.');
    });

    // Espera a que el puerto esté listo
    await new Promise<void>((resolve) => port.on('open', resolve));

    try {
        // --- 1. ABRIR FACTURA FISCAL (0x40) [cite: 559] ---
        console.log('\nComando: Abrir factura fiscal (0x40)');
        const camposAbrir: string[] = [
            DATOS_CLIENTE.razonSocial, // Campo 1: Razón social [cite: 574]
            DATOS_CLIENTE.rif,         // Campo 2: RIF [cite: 574]
            '7F', // Campo 3: Número de la factura en devolución ('7F' = no utilizado) [cite: 574]
            '7F', // Campo 4: Serial de la máquina fiscal en devolución ('7F' = no utilizado) [cite: 574]
            '7F', // Campo 5: Fecha de la factura en devolución ('7F' = no utilizado) [cite: 574]
            '7F', // Campo 6: Hora de la factura en devolución ('7F' = no utilizado) [cite: 574]
            '7E', // Campo 7: Calificador de comando ('7E' = Factura normal - ningún otro caso) [cite: 574]
            '7F', // Campo 8: No utilizado [cite: 574]
            '7F', // Campo 9: No utilizado [cite: 574]
        ];
        const comandoAbrir = construirComando('40', camposAbrir);
        
        const respuestaAbrir = await enviarComando(port, comandoAbrir);
        if (verificarError(respuestaAbrir)) return false;
        console.log('   Respuesta Abrir FF: ', respuestaAbrir);

        // --- 2. IMPRIMIR RENGLONES (0x42) [cite: 609] ---
        for (const item of ITEMS_FACTURA) {
            console.log(`\nComando: Imprimir Renglón (0x42) - ${item.descripcion}`);
            const camposItem: string[] = [
                item.descripcion,   // Campo 1: Descripción [cite: 638]
                item.cantidad,      // Campo 2: Cantidad (nnnn.nnn) [cite: 638]
                item.montoItem,     // Campo 3: Monto del ítem (nnnnnn.nn) [cite: 638]
                item.tasaImpositiva,// Campo 4: Tasa imponible [cite: 638]
                item.calificador,   // Campo 5: Calificador de ítem ('M' o 'm') [cite: 638]
                '7F', // Campo 6: No utilizado [cite: 638]
                '7F', // Campo 7: No utilizado [cite: 638]
                '7F', // Campo 8: No utilizado [cite: 638]
            ];
            const comandoItem = construirComando('42', camposItem);
            
            const respuestaItem = await enviarComando(port, comandoItem);
            if (verificarError(respuestaItem)) return false;
            console.log('   Respuesta Item: ', respuestaItem);
        }

        // --- 3. CERRAR FACTURA FISCAL (0x45) [cite: 665] ---
        console.log('\nComando: Cerrar factura fiscal (0x45)');
        const camposCerrar: string[] = [
            'T', // Campo 1: Calificador 'T' = Cierra e imprime completamente el documento [cite: 687]
            '0.00' // Campo 2: Monto del pago en Divisa (no utilizado si no se usa IGTF) [cite: 687]
        ];
        const comandoCerrar = construirComando('45', camposCerrar);

        const respuestaCerrar = await enviarComando(port, comandoCerrar);
        if (verificarError(respuestaCerrar)) return false;
        console.log('   Respuesta Cerrar FF: ', respuestaCerrar);
        
        console.log('\n✅ Factura Fiscal impresa exitosamente.');
        return true;

    } catch (error) {
        console.error('❌ Error fatal en la comunicación con el equipo fiscal:', error);
        return false;
    } finally {
        port.close();
        console.log('🔌 Puerto serial cerrado.');
    }
}

/**
 * Envía el comando al puerto serial y espera una respuesta completa.
 * @param port El puerto serial abierto.
 * @param comando El comando completo con STX, ETX y BCC.
 * @returns La respuesta completa de la impresora.
 */
function enviarComando(port: any, comando: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const TIMEOUT_MS = 10000; // 10 segundos
        let timeout: NodeJS.Timeout;

        const respuestaChunks: string[] = [];
        const onData = (data: Buffer) => {
            const dataString = data.toString('latin1');
            console.log({dataString}); // Para depuración

            // 1. Manejo del código de continuación (Equipo Procesando)
            if (dataString.includes('\x12')) {
                // Si se recibe $0\times 12$, la impresora indica que sigue procesando[cite: 289, 290].
                // Se debe reiniciar el temporizador (o extender el tiempo máximo)[cite: 297].
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    port.off('data', onData);
                    // Si se excede el tiempo de espera (incluso después del 0x12), declarar error de comunicación[cite: 298].
                    reject(new Error(`Timeout de respuesta (fallo de comunicación) para el comando: ${comando.slice(0, 10)}...`));
                }, TIMEOUT_MS);
                
                // Ignorar el $0\times 12$ en la acumulación de la trama de respuesta.
                return;
            }

            // 2. Acumulación de Chunks
            respuestaChunks.push(dataString);
            const respuestaCompleta = respuestaChunks.join('');
            console.log({dataString, respuestaChunks})
            // La respuesta final siempre es: STX + ... + ETX (1 byte) + BCC (4 bytes).
            // La longitud mínima para una respuesta es al menos 11 bytes (STX, Sec, Cmd, Sep, EstImpr, Sep, EstFisc, ETX, BCC).
            const MIN_RESPONSE_LENGTH = 11; 
            
            if (respuestaCompleta.length >= MIN_RESPONSE_LENGTH) {
                const indexETX = respuestaCompleta.lastIndexOf(ETX);

                // 3. Verificación de Terminación de Trama Completa (ETX + 4 caracteres BCC)
                if (indexETX !== -1 && (respuestaCompleta.length - indexETX) === 5) {
                    
                    // La trama está potencialmente completa. Verificamos el BCC.
                    const cuerpoHastaETX = respuestaCompleta.slice(0, indexETX + 1);
                    const bccRecibido = respuestaCompleta.slice(indexETX + 1);
                    const bccCalculado = calcularBCC(cuerpoHastaETX); // Se asume que calcularBCC está disponible.

                    // La verificación de BCC es el paso final para confirmar la integridad.
                    if (bccRecibido === bccCalculado) {
                        clearTimeout(timeout);
                        port.off('data', onData);
                        resolve(respuestaCompleta);
                        return;
                    } else {
                        // Si el BCC no coincide, no se considera una respuesta válida.
                        // En este punto, como la longitud es exacta, es un error de transmisión/cálculo.
                        console.error(`❌ BCC fallido. Recibido: ${bccRecibido}, Calculado: ${bccCalculado}.`);
                        clearTimeout(timeout);
                        port.off('data', onData);
                        reject(new Error("Error de integridad de datos (BCC no coincide)"));
                        return;
                    }
                }
            }
        };

        // Iniciar el timeout
        timeout = setTimeout(() => {
            port.off('data', onData);
            reject(new Error(`Timeout de respuesta (fallo de comunicación) para el comando: ${comando.slice(0, 10)}...`));
        }, TIMEOUT_MS);

        port.on('data', onData);

        // Envío del comando
        port.write(Buffer.from(comando, 'latin1'), (err: Error) => {
            if (err) {
                clearTimeout(timeout);
                port.off('data', onData);
                reject(new Error(`Error al escribir en el puerto serial: ${err.message}`));
            }
        });
    });
}

// Ejemplo de uso (ejecutar la función)
// (async () => {
//     await imprimirFacturaFiscal();
// })();

// Exportar la función principal y el tipo para uso externo si fuera necesario
export { imprimirFacturaFiscal, FacturaItem, DatosCliente };