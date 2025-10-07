import { SerialPort } from 'serialport';
import { Buffer } from 'buffer';

// --- 1. CONFIGURACIÓN DEL PUERTO SERIAL Y CONSTANTES ---
const PUERTO_SERIAL = 'COM3'; // ⚠️ CAMBIA ESTO por el puerto de tu impresora 
const BAUD_RATE = 9600;

// Códigos de comandos esenciales del protocolo PnP
const CMD = {
    STX: 0x02, // Start of Text
    ETX: 0x03, // End of Text
    SEP: 0x1C, // Separador de Campos (0x1C)
    ABRIR_FACTURA: 0x40, 
    IMPRIMIR_RENGLON: 0x42, 
    TOTALIZAR: 0x44, 
    
    // RESPUESTAS DE LA IMPRESORA (CRÍTICAS)
    ACK: 0x06, // Acknowledgment (Comando aceptado)
    NAK: 0x15, // Negative Acknowledgment (Error en comando/BCC/secuencia)
};

// Instancia del puerto serial
// NOTA: La instancia debe ser única y global para que el listener funcione correctamente.
const port = new SerialPort({
    path: PUERTO_SERIAL,
    baudRate: BAUD_RATE,
    // La impresora PnP normalmente usa: 8 data bits, 1 stop bit, no parity (default)
});

// Variables de estado fiscal
let secuencia = 0x20; // Número de secuencia inicial.

// --- 2. DATOS DE LA FACTURA (EJEMPLO) ---
const FACTURA_DATA = {
    productos: [
        { nombre: "Jabon en barra", cantidad: 2.00, precioUnitario: 5.50, iva: 16.00 },
        { nombre: "Refresco 2L", cantidad: 1.00, precioUnitario: 3.25, iva: 16.00 },
        { nombre: "Pan Canilla", cantidad: 1.00, precioUnitario: 1.50, iva: 8.00 },
    ],
    pago: {
        tipo: 'Efectivo', 
        monto: 15.75, 
    }
};

// --- 3. LÓGICA DEL PROTOCOLO (BCC y Formato) ---

/**
 * Convierte un número (float) a su representación en formato de protocolo PnP.
 * Retorna la cadena de dígitos sin punto decimal, rellenada con ceros a la izquierda.
 * @param {number} valor - Valor numérico.
 * @param {number} longitud_total - Longitud total de la cadena resultante (ej: 12 para precios, 13 para cantidades).
 * @param {number} longitud_decimal - Número de decimales.
 * @returns {string} - Cadena de texto formateada.
 */
function formatearValor(valor: any, longitud_total: number, longitud_decimal: number) {
    const factor = Math.pow(10, longitud_decimal);
    // 1. Redondear y multiplicar para obtener el entero que incluye decimales.
    // Ejemplo: 5.50 * 100 = 550
    const valor_entero = Math.round(valor * factor);

    // 2. Convertir a string
    let str_valor = valor_entero.toString();
    
    // 3. Rellenar con ceros a la izquierda hasta la longitud total requerida.
    // Ej: "550" a "0000000550" (10 dígitos en total si longitud_total es 12/2)
    return str_valor.padStart(longitud_total - (longitud_total > 10 ? 0 : 2), '0'); 
    // Usamos longitud_total - (longitud_total > 10 ? 0 : 2) para simplificar el padding en JS.
    // El precio (12/2) requiere 10 dígitos. La cantidad (13/3) requiere 10 dígitos.
    // Simplificamos:
    return str_valor.padStart(longitud_total - longitud_decimal, '0');
}


/**
 * Calcula el Block Check Character (BCC) o checksum XOR para el protocolo PnP.
 */
function calcularBCC(data: any) {
    let bcc = 0;
    for (let i = 0; i < data.length; i++) {
        bcc ^= data[i];
    }
    return Buffer.from([bcc]);
}


/**
 * Construye, envía el comando binario completo y ESPERA el ACK de la impresora.
 * Esta es la parte CRÍTICA para la sincronización.
 * @param {Buffer} trama_interna - El Buffer que contiene Sec, Comando, Campos de datos y ETX.
 * @returns {Promise<string>} - Promesa que se resuelve solo al recibir ACK (0x06).
 */
function enviarComandoBinario(trama_interna: any): Promise<string> {
    return new Promise((resolve, reject) => {
        // 1. Calcular BCC
        const bcc = calcularBCC(trama_interna);

        // 2. Ensamblar la trama completa: STX + Trama Interna + BCC
        const STX = Buffer.from([CMD.STX]);
        const trama_completa = Buffer.concat([STX, trama_interna, bcc]);
        
        const comandoHex = trama_interna[1].toString(16).toUpperCase();
        console.log(`\n-> [CMD ${comandoHex}] Enviando... Sec: ${trama_interna[0].toString(16).toUpperCase()} | BCC: ${bcc.toString('hex')}`);

        // 3. Listener Temporal para la Respuesta
        const responseListener = (data: Buffer) => {
          console.log({data})
            if (data[0] === CMD.ACK) {
                // Comando Aceptado: Limpiar listener y resolver la promesa
                port.off('data', responseListener);
                console.log(`<- [CMD ${comandoHex}] Recibido ACK (0x06). Listo para siguiente comando.`);
                resolve('Comando enviado y ACK recibido.');
            } else if (data[0] === CMD.NAK) {
                // Comando Rechazado: Limpiar listener y rechazar la promesa
                port.off('data', responseListener);
                const errorMessage = `<- [CMD ${comandoHex}] Recibido NAK (0x15). Comando rechazado. Verifique Secuencia/BCC/Formato.`;
                console.error(`❌ ${errorMessage}`);
                reject(new Error(errorMessage));
            }
            // Ignorar otros datos si es necesario
        };

        // 4. Adjuntar el listener
        port.on('data', responseListener);

        // 5. Enviar la trama binaria
        console.log('entrando')
        port.write(trama_completa, (err) => {
          console.log('enviando', err)
            if (err) {
                port.off('data', responseListener); // Limpiar en caso de error de escritura
                reject(new Error(`Error al escribir en el puerto serial: ${err.message}`));
            }
            // NOTA: No resolvemos aquí. La promesa se resuelve solo al recibir ACK en el listener.
        });
    });
}

// --- 4. SECUENCIA DE IMPRESIÓN FISCAL ---

/**
 * Ejecuta la secuencia completa de facturación fiscal.
 * @param {object} data - Datos de la factura.
 */
async function generarFacturaFiscal(data: any = FACTURA_DATA) {
    return new Promise(async (resolve, reject) => {
        
        // La instancia del puerto serial debe estar abierta antes de usarla
        if (!port.isOpen) {
             try {
                 await port.open();
             } catch (e: any) {
                 return reject(new Error(`No se pudo abrir el puerto serial ${PUERTO_SERIAL}. Error: ${e.message}`));
             }
        }

        console.log(`\n--- INICIANDO FACTURACIÓN FISCAL PnP ---`);
        try {
            
            // ===============================================
            // 1. COMANDO: Abrir Documento Venta (0x40)
            // ===============================================
            console.log('1. Abriendo factura (0x40)...');
            let cmd_abrir = Buffer.from([
                secuencia++,         // Sec
                CMD.ABRIR_FACTURA,   // Comando 0x40
                CMD.ETX              // ETX
            ]);
            await enviarComandoBinario(cmd_abrir); // Espera ACK antes de continuar


            // ===============================================
            // 2. COMANDO: Imprimir Renglones (0x42)
            // ===============================================
            
            for (const item of data.productos) {
                console.log(`2. Imprimiendo renglón: ${item.nombre}`);
            
                // Formato de los campos: Cantidad(13/3)|Precio(12/2)|IVA(4/2)|Nombre
                const campos = [
                    // 1. Cantidad (13 dígitos total, 3 decimales)
                    formatearValor(item.cantidad, 13, 3), 
                    
                    // 2. Precio Unitario (12 dígitos total, 2 decimales)
                    formatearValor(item.precioUnitario, 12, 2), 
                    
                    // 3. % IVA (4 dígitos total, 2 decimales, ej: "1600")
                    item.iva.toFixed(2).replace('.', '').padStart(4, '0'), 
                    
                    // 4. Nombre/Descripción del producto
                    item.nombre 
                    
                ].join(String.fromCharCode(CMD.SEP)); 

                let cmd_renglon = Buffer.from([
                    secuencia++,              // Sec
                    CMD.IMPRIMIR_RENGLON,     // Comando 0x42
                    ...Buffer.from(campos, 'ascii'), 
                    CMD.ETX                   // ETX
                ]);
                
                await enviarComandoBinario(cmd_renglon); // Espera ACK antes de pasar al siguiente ítem
            }
            

            // ===============================================
            // 3. COMANDO: Totalizar y Cerrar (0x44)
            // ===============================================
            
            console.log('3. Totalizando y cerrando factura (0x44)...');
            
            // Tipos de pago: E (Efectivo), T (Tarjeta), C (Cheque), O (Otro)
            const tipo_pago = data.pago.tipo[0].toUpperCase(); 
            // Monto pagado (12 dígitos total, 2 decimales)
            const monto_formato = formatearValor(data.pago.monto, 12, 2); 
            
            // Campos: Tipo de Pago | Monto Pagado
            const campos_totalizar = [
                tipo_pago,       
                monto_formato    
            ].join(String.fromCharCode(CMD.SEP));

            let cmd_totalizar = Buffer.from([
                secuencia++,              // Sec
                CMD.TOTALIZAR,            // Comando 0x44
                ...Buffer.from(campos_totalizar, 'ascii'), 
                CMD.ETX                   // ETX
            ]);
            await enviarComandoBinario(cmd_totalizar); // Espera ACK final

            console.log('\n✅ **Secuencia de Facturación Fiscal PnP completada.**');
            resolve({ success: true, mensaje: "Comandos enviados y confirmados por la impresora." });

        } catch (error: any) {
            console.error('❌ **ERROR FATAL:** La secuencia se detuvo debido a un NAK o error de puerto.');
            reject(new Error(`Fallo de facturación: ${error.message}`));
        } finally {
            // Cierra el puerto serial.
            setTimeout(() => {
                if (port.isOpen) port.close();
            }, 1000);
        }
    });
}

// Para usar con Express en Electron, debes exportar la función:
export { generarFacturaFiscal };

// Para probar directamente en Node, descomenta la siguiente línea:
// generarFacturaFiscal();
