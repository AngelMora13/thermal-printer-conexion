const SerialPort = require('serialport');
// Interfaces para la estandarización de datos y configuración
interface FacturaItem {
    descripcion: string; // Máx. 20 caracteres 
    cantidad: string;    // Formato nnnn.nnn 
    montoItem: string;   // Monto del ítem (sin impuesto), formato nnnnnn.nn 
    tasaImpositiva: string; // Tasa imponible (.nnnn o '0001' para Percibido) 
    calificador: 'M' | 'm'; // 'M' = monto agregado (suma), 'm' = anulación de ítem 
}

interface DatosCliente {
    razonSocial: string; // Máx. 38 caracteres 
    rif: string;         // Máx. 12 caracteres 
}

// Configuración de la comunicación serial
const COM_PORT = 'COM96'; // Reemplazar con el puerto serial real
const BAUD_RATE = 9600; // Velocidad de comunicación [cite: 259]
const SEPARADOR_CAMPO = '\x1C'; // Separador de Campo $0\times 1C$ [cite: 267]
const STX = '\x02'; // Inicio de texto $0\times 02$ [cite: 268]
const ETX = '\x03'; // Fin de texto $0\times 03$ [cite: 268]
const PLACEHOLDER_7F = '\x7F'; // Placeholder para campos no utilizados / vacíos, basado en el Apéndice B 

// Datos Estáticos para la Factura Fiscal (a modificar por el desarrollador)
let SECUENCIA = 0x20; // Inicializar número de secuencia en $0\times 20$ [cite: 271]

const DATOS_CLIENTE: DatosCliente = {
    razonSocial: 'CLIENTE OCASIONAL C.A.',
    rif: 'J000000000',
};

const ITEMS_FACTURA: FacturaItem[] = [
    {
        descripcion: 'PROD A GRV',
        cantidad: '1,000',
        montoItem: '1000,00',
        tasaImpositiva: '1600', // 16% -> Enviado como 1600 (.nnnn)
        calificador: 'M',
    },/*
    {
        descripcion: 'PRODUCTO B EXENTO',
        cantidad: '2.500',
        montoItem: '50.00',
        tasaImpositiva: '0000', // 0% -> Enviado como 0000
        calificador: 'M',
    },*/
];

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
 * Convierte un byte (valor ASCII) en su representación hexadecimal de 2 caracteres ASCII.
 * Ejemplo: 10 (0x0A) -> '0', 'A' (ASCII 30, 41)
 * @param byte El valor numérico del byte.
 * @returns Los 2 caracteres ASCII hexadecimales.
 */
function toHexChar(byte: number): string {
    const hex = byte.toString(16).toUpperCase().padStart(2, '0');
    return String.fromCharCode(parseInt(hex.slice(0, 1), 16) + (parseInt(hex.slice(0, 1), 16) < 10 ? 48 : 55)) +
           String.fromCharCode(parseInt(hex.slice(1, 2), 16) + (parseInt(hex.slice(1, 2), 16) < 10 ? 48 : 55));
}

/**
 * Calcula el Block Check Character (BCC) como la suma simple de los valores ASCII/Hex de todos
 * los caracteres desde STX hasta ETX, representado por 4 caracteres hexadecimales ASCII.
 * @param trama La trama de datos incluyendo STX y ETX.
 * @returns El BCC en formato de 4 caracteres hexadecimales ASCII (e.g., '05D9' de ASCII 30 35 44 39).
 */
function calcularBCC(trama: string): string {
    let sum = 0;
    for (let i = 0; i < trama.length; i++) {
        sum += trama.charCodeAt(i);
    }
    
    // El BCC es la suma (sum) en 4 caracteres hexadecimales.
    // Ej: Sum = 0x05D9. Los caracteres a enviar son '0', '5', 'D', '9' (ASCII $0\times 30, 0\times 35, 0\times 44, 0\times 39$).
    const hexBCC = sum.toString(16).toUpperCase().padStart(4, '0');
    let bccString = '';
    
    for (let i = 0; i < hexBCC.length; i++) {
        const char = hexBCC[i];
        if (char >= '0' && char <= '9') {
            bccString += String.fromCharCode(char.charCodeAt(0)); // '0'.. '9' -> ASCII $0\times 30..0\times 39$
        } else { // 'A' a 'F'
            bccString += String.fromCharCode(char.charCodeAt(0)); // 'A'.. 'F' -> ASCII $0\times 41..0\times 46$
        }
    }
    return bccString;
}

/**
 * Construye la trama completa del comando fiscal.
 * @param comandoHex El comando hexadecimal (e.g., '40').
 * @param campos Los campos de datos.
 * @returns La trama completa del comando.
 */
function construirComando(comandoHex: string, campos: string[]): string {
    const secuenciaChar = String.fromCharCode(SECUENCIA); // Número de secuencia [cite: 271]
    const comandoChar = String.fromCharCode(parseInt(comandoHex, 16));
    
    // Los campos se separan por $0\times 1C$. No se pone separador final[cite: 267].
    const cuerpoComando = secuenciaChar + comandoChar + SEPARADOR_CAMPO + campos.join(SEPARADOR_CAMPO);
    const trama = STX + cuerpoComando + ETX;
    const bcc = calcularBCC(trama);

    // Incrementar el número de secuencia para el próximo comando.
    SECUENCIA = (SECUENCIA === 0x7F) ? 0x20 : SECUENCIA + 1; //[cite: 271]

    return trama + bcc;
}

/**
 * Función principal para imprimir una Factura Fiscal.
 * @returns Una promesa que resuelve a true si la impresión es exitosa, false en caso contrario.
 */
async function imprimirFacturaFiscal(): Promise<boolean> {
    const SerialPort = require('serialport');
    const Readline = require('@serialport/parser-readline'); // No usado, se lee el buffer directamente

    console.log('Iniciando proceso de impresión de factura fiscal...');

    const port = new SerialPort.SerialPort({
        path: COM_PORT,
        baudRate: BAUD_RATE,
        autoOpen: false,
    });
    
    port.open((err: Error) => {
        if (err) {
            console.error('❌ Error al abrir el puerto serial:', err.message);
            return;
        }
        console.log('✅ Puerto serial abierto exitosamente.');
    });

    await new Promise<void>((resolve) => port.on('open', resolve));

    try {
        // --- 1. ABRIR FACTURA FISCAL (0x40) - REQUIERE 9 CAMPOS  ---
        console.log('\nComando: Abrir factura fiscal (0x40)');
        const camposAbrir: string[] = [
            DATOS_CLIENTE.razonSocial, // Campo 1: Razón social (Máx. 38) 
            DATOS_CLIENTE.rif,         // Campo 2: RIF del comprador (Máx. 12) 
            PLACEHOLDER_7F, // Campo 3: Número de la factura en devolución 
            PLACEHOLDER_7F, // Campo 4: Serial de la máquina fiscal en devolución 
            PLACEHOLDER_7F, // Campo 5: Fecha de la factura en devolución 
            PLACEHOLDER_7F, // Campo 6: Hora de la factura en devolución 
            PLACEHOLDER_7F, // Campo 7: Calificador de comando (No 'D' para devolución) [cite: 579]
            PLACEHOLDER_7F, // Campo 8: Campo no utilizado [cite: 579]
            PLACEHOLDER_7F, // Campo 9: Campo no utilizado [cite: 579]
        ];
        const comandoAbrir = construirComando('40', camposAbrir);
        
        const respuestaAbrir = await enviarComando(port, comandoAbrir);
        if (verificarError(respuestaAbrir)) return false;
        console.log('   Respuesta Abrir FF: ', respuestaAbrir);

        // --- 2. IMPRIMIR RENGLONES (0x42) - REQUIERE 8 CAMPOS  ---
        for (const item of ITEMS_FACTURA) {
            console.log(`\nComando: Imprimir Renglón (0x42) - ${item.descripcion}`);
            const camposItem: string[] = [
                item.descripcion,   // Campo 1: Descripción (Máx. 20) 
                item.cantidad,      // Campo 2: Cantidad (nnnn.nnn) 
                item.montoItem,     // Campo 3: Monto del ítem (nnnnnn.nn) 
                item.tasaImpositiva,// Campo 4: Tasa imponible (.nnnn) 
                item.calificador,   // Campo 5: Calificador ('M' o 'm') 
                PLACEHOLDER_7F, // Campo 6: Campo no utilizado 
                PLACEHOLDER_7F, // Campo 7: Campo no utilizado 
                PLACEHOLDER_7F, // Campo 8: Campo no utilizado 
            ];
            const comandoItem = construirComando('42', camposItem);
            
            const respuestaItem = await enviarComando(port, comandoItem);
            if (verificarError(respuestaItem)) return false;
            console.log('   Respuesta Item: ', respuestaItem);
        }

        // --- 3. CERRAR FACTURA FISCAL (0x45) - REQUIERE 2 CAMPOS  ---
        console.log('\nComando: Cerrar factura fiscal (0x45)');
        const camposCerrar: string[] = [
            'T', // Campo 1: Calificador 'T' = Cierra el documento fiscal activo 
            '0.00' // Campo 2: Monto del pago en Divisa para IGTF (se usa 0.00 si no aplica) 
        ];
        const comandoCerrar = construirComando('45', camposCerrar);

        const respuestaCerrar = await enviarComando(port, comandoCerrar);
        if (verificarError(respuestaCerrar)) return false;
        console.log('   Respuesta Cerrar FF: ', respuestaCerrar);
        
        console.log('\n✅ Factura Fiscal impresa exitosamente.');
        return true;

    } catch (error) {
        console.error('❌ Error fatal en la comunicación con el equipo fiscal:', error);
        abortarDocumentoPendiente(port);
        return false;
    } finally {
        port.close();
        console.log('🔌 Puerto serial cerrado.');
    }
}

/**
 * Verifica si la respuesta de la impresora fiscal indica un error.
 * @param respuesta La respuesta de la impresora.
 * @returns True si la respuesta contiene el string "ERROR", False en caso contrario.
 */
function verificarError(respuesta: string): boolean {
    if (respuesta.includes('ERROR')) { //[cite: 307]
        console.error('⚠️ Error en la respuesta del equipo fiscal:');
        console.error(respuesta);
        return true;
    }
    return false;
}
let respuestaChunks: string[] = [];
/**
 * Envía el comando al puerto serial y espera una respuesta completa.
 *
 * La lógica de terminación busca el final de la trama (ETX + 4 caracteres BCC)
 * en la cadena de respuesta completa acumulada, en lugar de depender del último chunk.
 *
 * @param port El puerto serial abierto.
 * @param comando El comando completo con STX, ETX y BCC.
 * @returns La respuesta completa de la impresora.
 */
function enviarComando(port: any, comando: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const TIMEOUT_MS = 10000; // 10 segundos
        let timeout: NodeJS.Timeout;

        // Se usa una variable fuera del scope de onData para acumular todos los chunks
        const respuestaChunks: string[] = [];
        
        // --- INICIO: Lógica del Listener de Datos ---
        const onData = (data: Buffer) => {
            // Decodificar como bytes latinos para mantener caracteres de control
            const dataString = data.toString('latin1');
            
            // Si el chunk es solo el código de continuación (0x12), reiniciar el timeout y salir.
            if (dataString === '\x12') {
                // Reiniciar el temporizador al recibir un código de continuación.
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    port.off('data', onData);
                    reject(new Error(`Timeout de respuesta (fallo de comunicación) para el comando: ${comando.slice(0, 10)}...`));
                }, TIMEOUT_MS);
                return; 
            }

            // Acumular los datos recibidos (la trama real de respuesta)
            respuestaChunks.push(dataString);
            const respuestaCompleta = respuestaChunks.join('');

            // La respuesta final debe ser lo suficientemente larga (min. 11 bytes para una respuesta simple)
            const MIN_RESPONSE_LENGTH = 11; 
            
            if (respuestaCompleta.length >= MIN_RESPONSE_LENGTH) {
                const indexETX = respuestaCompleta.lastIndexOf(ETX);

                // La trama se considera potencialmente completa si encontramos ETX 
                // y hay exactamente 4 caracteres de BCC después de él.
                if (indexETX !== -1 && (respuestaCompleta.length - indexETX) === 5) {
                    
                    // Separar el cuerpo (hasta ETX) y el BCC
                    const cuerpoHastaETX = respuestaCompleta.slice(0, indexETX + 1);
                    const bccRecibido = respuestaCompleta.slice(indexETX + 1);
                    
                    // Asumimos que calcularBCC está disponible y funciona correctamente.
                    const bccCalculado = calcularBCC(cuerpoHastaETX);
                    
                    // 4. Verificación de Integridad del BCC
                    if (bccRecibido === bccCalculado) {
                        clearTimeout(timeout);
                        port.off('data', onData);
                        resolve(respuestaCompleta); // LA PROMESA SE RESUELVE AQUÍ
                        return;
                    } else {
                        // Error de BCC, la trama recibida no es válida. Se rechaza inmediatamente.
                        clearTimeout(timeout);
                        port.off('data', onData);
                        reject(new Error(`Error de integridad de datos (BCC no coincide). Trama recibida: ${respuestaCompleta}`));
                        return;
                    }
                }
            }
        };
        // --- FIN: Lógica del Listener de Datos ---

        // Iniciar el timeout (se reinicia si llega 0x12)
        timeout = setTimeout(() => {
            port.off('data', onData);
            // Si llega el timeout, se asume fallo de comunicación/trama incompleta
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

// Exportar la función principal y el tipo para uso externo si fuera necesario
export { imprimirFacturaFiscal, FacturaItem, DatosCliente };