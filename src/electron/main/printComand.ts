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
    baudRate: BAUD_RATE, // Corregido: Usar BAUD_RATE
    // La impresora PnP normalmente usa: 8 data bits, 1 stop bit, no parity (default)
});

// Variables de estado fiscal
let secuencia = 0x00; // Número de secuencia inicial (más seguro al empezar).

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
    },
    // NUEVO: Información del cliente genérico para Consumidor Final
    cliente: {
        rif: 'V251888147', // RIF/CUIT genérico (se puede cambiar si es un cliente real)
        nombre: 'CONSUMIDOR FINAL',
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
    const valor_entero = Math.round(valor * factor);

    // 2. Convertir a string
    let str_valor = valor_entero.toString();
    
    // 3. Rellenar con ceros a la izquierda hasta la longitud total requerida.
    // Usamos str_valor.padStart(longitud_total - longitud_decimal, '0') que es la forma correcta.
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
 * Construye, envía el comando binario completo y ESPERA el ACK/NAK de la impresora.
 * Modificado para manejar respuestas fragmentadas y errores de múltiples bytes.
 * @param {Buffer} trama_interna - El Buffer que contiene Sec, Comando, Campos de datos y ETX.
 * @returns {Promise<string>} - Promesa que se resuelve solo al recibir ACK (0x06).
 */
/*
function enviarComandoBinario(trama_interna: any): Promise<string> {
    return new Promise((resolve, reject) => {
        // Búfer para acumular los fragmentos de la respuesta
        let currentResponse: any = Buffer.alloc(0);

        // 1. Calcular BCC
        const bcc = calcularBCC(trama_interna);

        // 2. Ensamblar la trama completa: STX + Trama Interna + BCC
        const STX = Buffer.from([CMD.STX]);
        const trama_completa = Buffer.concat([STX, trama_interna, bcc]);
        
        const comandoHex = trama_interna[1].toString(16).toUpperCase();
        console.log(`\n-> [CMD ${comandoHex}] Enviando... Sec: ${trama_interna[0].toString(16).toUpperCase()} | BCC: ${bcc.toString('hex')}`);

        // 3. Listener Temporal para la Respuesta
        const responseListener = (data: Buffer) => {
            // console.log({data}); // Mantener el log de fragmentos si es útil

            // Acumular el fragmento
            currentResponse = Buffer.concat([currentResponse, data]);

            // --- 3.1 Chequeo de Respuesta Simple (ACK/NAK) ---
            // Las respuestas ACK/NAK suelen ser bytes individuales, pero las buscamos en cualquier parte del buffer.
            if (currentResponse.includes(CMD.ACK)) {
                // Comando Aceptado
                port.off('data', responseListener);
                console.log(`<- [CMD ${comandoHex}] Recibido ACK (0x06). Listo para siguiente comando.`);
                resolve('Comando enviado y ACK recibido.');
                return;
            }
            
            if (currentResponse.includes(CMD.NAK)) {
                // Comando Rechazado
                port.off('data', responseListener);
                const errorMessage = `<- [CMD ${comandoHex}] Recibido NAK (0x15). Comando rechazado. Verifique Secuencia/BCC/Formato.`;
                console.error(`❌ ${errorMessage}`);
                reject(new Error(errorMessage));
                return;
            }
            
            // --- 3.2 Chequeo de Respuesta Compleja (Status o ERROR) ---
            // Buscamos la secuencia ASCII "ERROR" o el fin de una trama de estado (ETX, 0x03).
            
            const errorIndex = currentResponse.indexOf('ERROR');
            const etxIndex = currentResponse.indexOf(CMD.ETX); // 0x03

            if (errorIndex !== -1 || etxIndex !== -1) {
                // Si encontramos "ERROR" o el fin de la trama (ETX), asumimos que la impresora 
                // envió un mensaje de estado/error que interrumpe la secuencia.
                port.off('data', responseListener);
                
                // Intentar decodificar el mensaje para el usuario
                let responseText = currentResponse.toString('ascii').trim();
                
                // Limpiar eco si existe (empieza con STX)
                if (currentResponse[0] === CMD.STX && responseText.length > 1) {
                    responseText = responseText.substring(2);
                }

                // Generar un error claro
                console.error(`❌ [CMD ${comandoHex}] RESPUESTA INESPERADA (Error Fiscal):`, responseText);
                reject(new Error(`Respuesta Fiscal: ${responseText}. La secuencia se detiene.`));
                return;
            }
            // Si no se encontró ni ACK, ni NAK, ni ERROR, ni ETX, se sigue esperando más datos.
        };

        // 4. Adjuntar el listener
        port.on('data', responseListener);

        // 5. Enviar la trama binaria
        port.write(trama_completa, (err) => {
            if (err) {
                port.off('data', responseListener); // Limpiar en caso de error de escritura
                reject(new Error(`Error al escribir en el puerto serial: ${err.message}`));
            }
            // NOTA: La promesa se resuelve solo al recibir ACK/NAK en el listener.
        });
    });
} */
function enviarComandoBinario(trama_datos: any) {
    return new Promise((resolve, reject) => {
        // 1. Calcular BCC sobre los bytes desde Sec hasta ETX
        const bcc = calcularBCC(trama_datos);

        // 2. Ensamblar la trama completa: STX + Trama + BCC
        const STX = Buffer.from([0x02]);
        const trama_completa = Buffer.concat([STX, trama_datos, bcc]);
        
        console.log(`\n--- ENVIANDO COMANDO ---`);
        console.log(`Buffer completo (Hex): ${trama_completa.toString('hex')}`);
        console.log(`Buffer de datos: ${trama_datos.toString('hex')}`);
        console.log(`BCC Calculado (Hex): ${bcc.toString('hex')}`);

        port.write(trama_completa, (err) => {
            if (err) {
                console.error(`Error al escribir en el puerto serial: ${err.message}`);
                reject(err);
            } else {
              setTimeout(() => {
                resolve('Comando binario enviado correctamente.');
              }, 2000);
            }
        });
    });
}

// --- 4. SECUENCIA DE IMPRESIÓN FISCAL ---

/**
 * Ejecuta la secuencia completa de facturación fiscal.
 * @param {object} data - Datos de la factura.
 */
async function generarFacturaFiscal() {
  const data = FACTURA_DATA
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
            // 1. COMANDO: Abrir Documento Venta (0x40) - CORREGIDO
            // ===============================================
            // Ahora incluimos los campos de RIF/CUIT y Nombre/Razón Social.
            
            console.log('1. Abriendo factura (0x40) con tipo F y datos de cliente...');
            
            const cliente = data.cliente;
            
            // Campos: F | SEP | RIF del cliente | SEP | Nombre del cliente | SEP | ... (otros campos opcionales vacíos)
            const campos_string = String.fromCharCode(CMD.SEP) + 
                                  cliente.rif + String.fromCharCode(CMD.SEP)
                                  //cliente.nombre+ String.fromCharCode(CMD.SEP) 
            const campos_string2 = String.fromCharCode(CMD.SEP) + cliente.nombre + String.fromCharCode(CMD.SEP) 
            
            const campos_abrir = Buffer.from(campos_string, 'hex');
            const campos_abrir2 = Buffer.from(campos_string2, 'hex');
            
            let cmd_abrir = Buffer.from([
                secuencia++,         // Sec
                CMD.ABRIR_FACTURA,   // Comando 0x40
                CMD.SEP,
                ...campos_abrir, 
                ...campos_abrir2,     // Campo de datos: 'F' + 0x1C + RIF + 0x1C + Nombre
                CMD.SEP,
                CMD.ETX              // ETX
            ]);
            await enviarComandoBinario(cmd_abrir); // Espera ACK antes de continuar


            // ===============================================
            // 2. COMANDO: Imprimir Renglones (0x42)
            // ===============================================
            
            for (const item of data.productos) {
                console.log(`2. Imprimiendo renglón: ${item.nombre}`);
            
                // La documentación indica el orden: Descripción | Cantidad | Monto | Tasa | Calificador | (3x Vacío)
                const campos = [
                    // Campo 1: Descripción (Nombre del producto, hasta 20 caracteres)
                    item.nombre, 

                    // Campo 2: Cantidad (13 dígitos total, 3 decimales, formato nnnn.nnn)
                    formatearValor(item.cantidad, 13, 3), 
                    
                    // Campo 3: Monto del ítem / Precio Unitario (12 dígitos total, 2 decimales, formato nnnnnn.nn)
                    // Nota: Se asume Monto Unitario, si es Total, el formateo sigue siendo 12/2
                    formatearValor(item.precioUnitario, 12, 2), 
                    
                    // Campo 4: Tasa imponible (4 dígitos total, 2 decimales, formato .nnnn, ej: "1600" para 16%)
                    item.iva.toFixed(2).replace('.', '').padStart(4, '0'), 

                    // Campo 5: Calificador de ítem de línea ('M' = Monto agregado mercadería)
                    'M', 
                    
                    // Campo 6, 7, 8: Campos no utilizados (se usan strings vacíos para incluir los separadores 0x1C)
                    '', 
                    '', 
                    '' 
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
