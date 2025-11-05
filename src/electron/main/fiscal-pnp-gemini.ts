// fiscal-pnp.ts
import { SerialPort, SerialPortOpenOptions } from 'serialport';

// Constantes del Protocolo PNP
const STX = 0x02; // Start of Text
const ETX = 0x03; // End of Text
const FS = 0x1C;  // Field Separator (Separador de Campo)

// Interfaz para los datos de la factura
export interface FacturaData {
    razonSocial: string; // Se usa en el comando 0x40
    rif: string;         // Se usa en el comando 0x40
    direccion: string;   // Se usa en el comando 0x40
    // Lista de productos: tasaIva debe coincidir con la configuración de la impresora (ej. 1, 2, 3)
    productos: { descripcion: string, cantidad: number, precio: number, tasaIva: number }[];
    pagoDivisaMonto: number; // Monto de pago en divisa para IGTF (Comando 0x45)
}

// Clase para gestionar la comunicación con la impresora fiscal PNP
export class FiscalPNPService {
    private port: SerialPort | null = null;
    private sequenceNumber: number = 0x20; // Inicia en 0x20 (' ') y va hasta 0x7F ('~') 

    // FUNCIÓN PLACEHOLDER PARA BCC: VERIFICAR ALGORITMO REAL
    private calculateBCC(data: Buffer): string {
        let bcc = 0;
        // Se calcula sobre todos los bytes *después* de STX y *antes* de ETX
        for (let i = 1; i < data.length - 1; i++) {
            bcc ^= data[i];
        }
        // Devuelve el BCC como 4 caracteres ASCII hexadecimales (ej: 0x1A -> "001A")
        return bcc.toString(16).toUpperCase().padStart(4, '0');
    }

    // Función auxiliar para construir el paquete de comando fiscal
    private buildCommand(commandCode: string, fields: (string | number)[]): Buffer {
        // Incrementar el número de secuencia
        this.sequenceNumber = (this.sequenceNumber < 0x7F) ? this.sequenceNumber + 1 : 0x20;
        
        // El código del comando (ej. '0x40') se envía como parte del payload
        const commandText = commandCode.startsWith('0x') ? commandCode.substring(2) : commandCode;
        
        // Construir la carga útil (SEC + CMD + Campos)
        let payload = String.fromCharCode(this.sequenceNumber) + commandText;

        if (fields && fields.length > 0) {
            // El separador de campo es 0x1C 
            payload += String.fromCharCode(FS) + fields.join(String.fromCharCode(FS));
        }

        // Convertir a Buffer (usando 'latin1' para preservar los bytes 0x02, 0x1C, 0x03)
        const payloadBuffer = Buffer.from(payload, 'latin1');

        // Construir el buffer completo para BCC (incluye STX, payload, ETX)
        const fullDataBuffer = Buffer.concat([
            Buffer.from([STX]),
            payloadBuffer,
            Buffer.from([ETX])
        ]);

        // Calcular BCC y convertir a Buffer ASCII
        const bccString = this.calculateBCC(fullDataBuffer);
        
        // Comando final: STX + payload + ETX + BCC
        const finalCommand = Buffer.concat([
            fullDataBuffer,
            Buffer.from(bccString, 'ascii')
        ]);

        return finalCommand;
    }

    // Función para enviar comandos al puerto serial
    private async sendCommand(commandBuffer: Buffer): Promise<string> {
        if (!this.port || !this.port.isOpen) {
            throw new Error("El puerto serial no está abierto. Use 'seleccionarPuerto' primero.");
        }
        
        return new Promise((resolve, reject) => {
            console.log('Comando enviado (HEX):', commandBuffer.toString('hex'));
            this.port?.write(commandBuffer, (err) => {
                if (err) {
                    return reject(`Error de escritura: ${err.message}`);
                }
                // En un entorno real se debe esperar y parsear la respuesta de la impresora.
                resolve('Comando enviado con éxito. Esperando respuesta de la impresora...');
            });
        });
    }

    // 1. Listar los puertos COM
    public async listPorts(): Promise<any> {
        return await SerialPort.list();
    }

    // 2. Abrir/Seleccionar el puerto COM
    public async openPort(path: string): Promise<string> {
        return new Promise((resolve, reject) => {
            if (this.port && this.port.isOpen) {
                // Cerrar el puerto si ya está abierto
                this.port.close((err) => {
                    if (err) console.error("Error al cerrar puerto existente:", err);
                    this.port = null;
                    this.openNewPort(path, resolve, reject);
                });
            } else {
                this.openNewPort(path, resolve, reject);
            }
        });
    }

    private openNewPort(path: string, resolve: (value: string) => void, reject: (reason?: any) => void): void {
        // Parámetros de comunicación basados en el manual (9600, 8, N, 1) [cite: 1170, 1171]
        const options: SerialPortOpenOptions<any> = {
            path,
            baudRate: 9600,
            dataBits: 8,
            stopBits: 1,
            parity: 'none'
        };

        this.port = new SerialPort(options, (err) => {
            if (err) {
                this.port = null;
                return reject(`Error al abrir el puerto ${path}: ${err.message}`);
            }
            resolve(`Puerto ${path} abierto y configurado a ${options.baudRate}.`);
        });

        // Manejar datos de respuesta (Estados Fiscal y de Impresora)
        this.port.on('data', (data) => {
            console.log('Respuesta de la impresora:', data.toString('hex'));
            // Aquí se debe implementar el parser de respuesta para obtener los estados [cite: 1209, 1210]
        });
    }

    // 3. Impresión de Prueba (Documento No Fiscal)
    public async testPrint(): Promise<string> {
        // Secuencia: Abrir DNF (0x48) -> Imprimir Texto DNF (0x49) -> Cerrar DNF (0x4A) 
        try {
            // 1. Abrir documento no fiscal (0x48) 
            await this.sendCommand(this.buildCommand('48', []));

            // 2. Imprimir texto (0x49) (máx 40 caracteres) [cite: 1289]
            await this.sendCommand(this.buildCommand('49', ['PRUEBA DE IMPRESION FISCAL PNP']));
            await this.sendCommand(this.buildCommand('49', ['SISTEMA ELECTRON/VUE 3']));
            
            // 3. Cerrar documento no fiscal (0x4A) 
            await this.sendCommand(this.buildCommand('4A', []));

            return "Impresión de prueba (Documento No Fiscal) enviada a la impresora.";
        } catch (error: any) {
            throw new Error(`Error en la impresión de prueba: ${error.message}`);
        }
    }

    // 4. Impresión de Factura Completa (Fiscal)
    public async printFactura(data: FacturaData): Promise<string> {
        // Secuencia: Abrir FF (0x40) -> Ítems (0x42) -> Cerrar FF (0x45) 
        try {
            // 1. Abrir factura fiscal (0x40) 
            // Campos esperados: RIF, Razón Social, Dirección, etc.
            const openFacturaFields = [
                data.rif,              // Campo 1: RIF/CI
                data.razonSocial,      // Campo 2: Razón Social
                data.direccion,        // Campo 3: Dirección
                '', '', '',            // Campos 4, 5, 6: No utilizados para Factura normal [cite: 1196]
                '',                    // Campo 7: Tipo de documento (Vacío para Factura normal) [cite: 1197]
                '', ''                 // Campos 8, 9: No utilizados [cite: 1198]
            ];
            await this.sendCommand(this.buildCommand('40', openFacturaFields));

            // 2. Imprimir Renglón por producto (0x42) 
            for (const item of data.productos) {
                // Tasa Impositiva (ej. '1' para Tasa A, '2' para Tasa B, etc.)
                const tasa = item.tasaIva.toString();
                
                const itemFields = [
                    item.descripcion,
                    item.cantidad.toFixed(2),  // Cantidad
                    item.precio.toFixed(2),    // Precio Unitario
                    tasa,                      // Tasa (1, 2 o 3, etc.)
                    'M'                        // Calificador ('M' = Mercancía)
                ];
                await this.sendCommand(this.buildCommand('42', itemFields));
            }
            
            // 3. Cerrar factura fiscal (0x45) 
            // Calificador: 'T' = Cierre normal; 'U' = Cierre y agrega IGTF (si aplica) [cite: 1246]
            const calificador = data.pagoDivisaMonto > 0 ? 'U' : 'T';
            
            const closeFacturaFields = [
                calificador,
                data.pagoDivisaMonto.toFixed(2), // Monto en Divisa
                '' // Campo 3: Forma de Pago (opcional)
            ];
            await this.sendCommand(this.buildCommand('45', closeFacturaFields));

            return "Factura fiscal enviada con éxito.";
        } catch (error: any) {
            throw new Error(`Error al imprimir la factura: ${error.message}`);
        }
    }
}