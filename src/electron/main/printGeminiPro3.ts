const SerialPort = require('serialport');

// --- Interfaces y Tipos ---

export interface FacturaItem {
    descripcion: string; // Máx 20 caracteres [cite: 246]
    cantidad: number;    // Se convertirá a formato nnnn.nnn
    montoItem: number;   // Se convertirá a formato nnnnnn.nn
    tasaImpositiva: number; // '1600' (16%), '0800' (8%), '0000' (Exento)
    calificador: 'M' | 'm'; // 'M': Suma, 'm': Anula ítem [cite: 247]
}

export interface DatosCliente {
    razonSocial: string; // Máx 38 caracteres [cite: 221]
    rif: string;         // Máx 12 caracteres [cite: 222]
}

interface RespuestaFiscal {
    exito: boolean;
    secuenciaRecibida: number;
    comandoRecibido: string;
    statusImpresoraHex: string;
    statusFiscalHex: string;
    erroresDetectados: string[];
    datos: string[];
    tramaOriginal: string;
}

// --- Constantes del Protocolo ---
const SEPARADOR = '\x1C'; // Separador de Campo [cite: 104]
const STX = '\x02';       // Start of Text [cite: 104]
const ETX = '\x03';       // End of Text [cite: 104]
const BUSY_BYTE = '\x12'; // Caracter de procesamiento 
const TIMEOUT_DEFAULT = 5000;
const TIMEOUT_EXTENDIDO = 20000; // Para reportes Z o cierres

export class ControladorFiscal {
    private port: any; // Tipo 'any' para compatibilidad con serialport, idealmente usar tipo específico
    private secuenciaActual: number = 0x20; // Inicia en 32 decimal 
    private path: string;
    private baudRate: number;

    constructor(path: string, baudRate: number = 9600) {
        this.path = path;
        this.baudRate = baudRate;
    }

    /**
     * Abre la conexión con el puerto serial.
     */
    public async conectar(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.port = new SerialPort.SerialPort({
                path: this.path,
                baudRate: this.baudRate,
                autoOpen: false
            });

            this.port.open((err: Error) => {
                if (err) reject(new Error(`Error abriendo puerto: ${err.message}`));
                else {
                    console.log(`✅ Conectado a ${this.path} @ ${this.baudRate}`);
                    // Limpiar buffer inicial por si hay basura
                    this.port.flush(() => resolve());
                }
            });
        });
    }

    public async desconectar(): Promise<void> {
        if (this.port && this.port.isOpen) {
            return new Promise((resolve) => {
                this.port.close(() => {
                    console.log('🔌 Puerto cerrado.');
                    resolve();
                });
            });
        }
    }

    /**
     * Realiza el ciclo completo de una factura fiscal.
     */
    public async procesarFactura(cliente: DatosCliente, items: FacturaItem[]): Promise<boolean> {
        try {
            // 1. Verificar estado antes de empezar (Opcional pero recomendado)
            await this.verificarEstado();

            // 2. Abrir Factura Fiscal (Cmd 0x40)
            console.log('📄 Abriendo Factura...');
            const respAbrir = await this.enviarComando('40', [
                cliente.razonSocial,
                cliente.rif,
                '7F', '7F', '7F', '7F', // Campos vacíos (Devolución)
                '7F', '7F', '7F'      // Campos reservados/vacíos
            ]);
            if (!respAbrir.exito) throw new Error(`Fallo al abrir factura: ${respAbrir.erroresDetectados.join(', ')}`);

            // 3. Enviar Ítems (Cmd 0x42)
            for (const item of items) {
                console.log(`📦 Agregando ítem: ${item.descripcion}`);
                const respItem = await this.enviarComando('42', [
                    item.descripcion,
                    item.cantidad, // Cantidad nnnn.nnn
                    item.montoItem, // Monto nnnnnn.nn
                    item.tasaImpositiva,
                    item.calificador,
                    '7F', '7F', '7F' // Campos reservados
                ]);
                if (!respItem.exito) throw new Error(`Error en ítem ${item.descripcion}: ${respItem.erroresDetectados.join(', ')}`);
            }

            // 4. Cerrar Factura (Cmd 0x45)
            console.log('🏁 Cerrando Factura...');
            const respCerrar = await this.enviarComando('45', [
                'T',    // T = Cierre Total [cite: 258]
                0    // Pago directo / IGTF
            ]);

            if (!respCerrar.exito) throw new Error(`Error al cerrar: ${respCerrar.erroresDetectados.join(', ')}`);

            console.log('✅ Factura procesada exitosamente.');
            return true;

        } catch (error) {
            console.error('❌ Error Crítico en Proceso:', error);
            // Intentar cancelar/cerrar si quedó abierta
            await this.intentarRecuperacion();
            return false;
        }
    }

    /**
     * Envía comando y gestiona la secuencia y validación.
     */
    private async enviarComando(cmdHex: string, parametros: any[]): Promise<RespuestaFiscal> {
        const secuenciaParaEnvio = this.obtenerSiguienteSecuencia();
        const trama = this.construirTrama(secuenciaParaEnvio, cmdHex, parametros);
        
        console.log(`➡️ TX [Seq:${secuenciaParaEnvio.toString(16)} Cmd:${cmdHex}]: ${trama.replace(/\x1C/g, '|').substring(0, 50)}...`);

        const respuestaRaw = await this.escribirYLeer(trama);
        const respuestaParseada = this.parsearRespuesta(respuestaRaw);

        // Validar coincidencia de secuencia 
        if (respuestaParseada.secuenciaRecibida !== secuenciaParaEnvio) {
            console.warn(`⚠️ Advertencia de secuencia: Enviada ${secuenciaParaEnvio.toString(16)}, Recibida ${respuestaParseada.secuenciaRecibida.toString(16)}`);
            // Nota: En entornos ruidosos, a veces se reintenta aquí. Por ahora, alertamos.
        }

        return respuestaParseada;
    }

    /**
     * Construye la trama física bytes según protocolo.
     */
    private construirTrama(secuencia: number, cmdHex: string, params: string[]): string {
        const seqChar = String.fromCharCode(secuencia);
        const cmdChar = String.fromCharCode(parseInt(cmdHex, 16));
        // Unimos parámetros con 0x1C. NO poner 0x1C al final si no hay más datos.
        const payload = seqChar + cmdChar + SEPARADOR + params.join(SEPARADOR);
        
        const base = STX + payload + ETX;
        const bcc = this.calcularBCC(base);
        return base + bcc;
    }

    /**
     * Lógica de bajo nivel para escritura y lectura con timeout dinámico.
     */
    private escribirYLeer(data: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const chunks: string[] = [];
            let timer: NodeJS.Timeout;
            let timeoutMs = TIMEOUT_DEFAULT;

            const resetTimer = () => {
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => {
                    limpiarListeners();
                    reject(new Error("Timeout esperando respuesta de impresora"));
                }, timeoutMs);
            };

            const onData = (buffer: Buffer) => {
                const str = buffer.toString('latin1'); // 'latin1' preserva bytes 0x80-0xFF
                
                // Manejo de Busy (0x12) 
                if (str === BUSY_BYTE) {
                    console.log('⏳ Impresora procesando...');
                    timeoutMs += 800; 
                    resetTimer();
                    return;
                }

                chunks.push(str);
                const totalStr = chunks.join('');

                // Buscar ETX
                const etxIndex = totalStr.lastIndexOf(ETX);
                if (etxIndex !== -1) {
                    // Verificar si tenemos los 4 bytes de BCC después del ETX
                    if (totalStr.length >= etxIndex + 5) {
                        limpiarListeners();
                        clearTimeout(timer);
                        resolve(totalStr);
                    }
                }
            };

            const limpiarListeners = () => {
                this.port.off('data', onData);
            };

            this.port.on('data', onData);
            resetTimer();

            this.port.write(Buffer.from(data, 'latin1'), (err: Error) => {
                if (err) {
                    limpiarListeners();
                    clearTimeout(timer);
                    reject(err);
                }
            });
        });
    }

    /**
     * Parsea la trama cruda, valida BCC y extrae estados.
     */
    private parsearRespuesta(trama: string): RespuestaFiscal {
        // Limpiar STX inicial
        const limpia = trama.startsWith(STX) ? trama.substring(1) : trama;
        
        // Validar BCC
        const etxIndex = limpia.lastIndexOf(ETX);
        const cuerpoConETX = STX + limpia.substring(0, etxIndex + 1); // Reconstruir para calculo
        const bccRecibido = limpia.substring(etxIndex + 1, etxIndex + 5);
        const bccCalculado = this.calcularBCC(cuerpoConETX);

        if (bccRecibido !== bccCalculado) {
            throw new Error(`Error BCC: Recibido ${bccRecibido} vs Calculado ${bccCalculado}`);
        }

        // Separar campos
        // Estructura: SeqCmd(1byte+1byte) | StatusP | StatusF | Data...
        const rawPayload = limpia.substring(0, etxIndex);
        const campos = rawPayload.split(SEPARADOR);

        // Campo 0 contiene Seq y Cmd pegados, o a veces separados por lógica del driver interno.
        // El protocolo dice: STX Seq Cmd SEP Status...
        // Pero al recibir, el primer bloque antes del primer 0x1C contiene Seq y Cmd.
        const cabecera = campos[0]; 
        const seqRecibida = cabecera.charCodeAt(0);
        const cmdRecibido = cabecera.length > 1 ? cabecera.charAt(1) : '?';

        const statusP = campos[1]; // Status Impresora (4 chars Hex)
        const statusF = campos[2]; // Status Fiscal (4 chars Hex)
        const data = campos.slice(3);

        const errores = this.analizarEstado(statusP, statusF);
        
        // Si la trama contiene la palabra ERROR explícita
        if (trama.includes('ERROR')) {
            errores.push(`Respuesta negativa del dispositivo: ${campos.join('|')}`);
        }

        return {
            exito: errores.length === 0,
            secuenciaRecibida: seqRecibida,
            comandoRecibido: cmdRecibido,
            statusImpresoraHex: statusP,
            statusFiscalHex: statusF,
            erroresDetectados: errores,
            datos: data,
            tramaOriginal: trama
        };
    }

    /**
     * Analiza los bits de estado 
     */
    private analizarEstado(stPrinter: string, stFiscal: string): string[] {
        const errores: string[] = [];
        const p = parseInt(stPrinter, 16);
        const f = parseInt(stFiscal, 16);

        // Bits críticos de Impresora
        if ((p & 0x0004)) errores.push("Error/Falla de Impresora");
        if ((p & 0x0008)) errores.push("Impresora Offline"); // Bit 3 (mask 8)
        if ((p & 0x4000)) errores.push("Sin Papel");         // Bit 14

        // Bits críticos Fiscales
        if ((f & 0x0001)) errores.push("Error Memoria Fiscal");
        if ((f & 0x0002)) errores.push("Error Memoria Trabajo");
        if ((f & 0x0008)) errores.push("Comando no reconocido");
        if ((f & 0x0010)) errores.push("Campo de datos inválido");
        if ((f & 0x0040)) errores.push("Desbordamiento de totales");
        if ((f & 0x0080)) errores.push("Memoria Fiscal Llena");
        
        // Bit 11: Requiere Z (No es error fatal per se, pero impide facturar)
        if ((f & 0x0800)) errores.push("BLOQUEO: Se requiere Reporte Z");

        return errores;
    }

    private calcularBCC(trama: string): string {
        let sum = 0;
        for (let i = 0; i < trama.length; i++) {
            sum += trama.charCodeAt(i);
        }
        // Convertir a hex, uppercase, padding 4 ceros.
        // El protocolo usa representación ASCII de los hex: 0x05D9 -> '0','5','D','9'
        return sum.toString(16).toUpperCase().padStart(4, '0');
    }

    private obtenerSiguienteSecuencia(): number {
        // Rango 0x20 (32) a 0x7F (127) 
        const seq = this.secuenciaActual;
        this.secuenciaActual++;
        if (this.secuenciaActual > 0x7F) {
            this.secuenciaActual = 0x20;
        }
        return seq;
    }

    private formatearNumero(num: number, decimales: number): string {
        // Asegura formato inglés (punto decimal) sin comas de miles
        return num.toFixed(decimales);
    }

    /**
     * Intenta restaurar el estado si algo falla (Reset + Cierre forzado)
     */
    private async intentarRecuperacion() {
        console.warn('⚠️ Intentando recuperación de estado...');
        try {
            // Enviar Reset de software [cite: 130]
            const resetSeq = Buffer.from([0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E]);
            this.port.write(resetSeq);
            await new Promise(r => setTimeout(r, 2000));
            
            // Intentar cerrar cualquier documento colgado
            // Usamos secuencia arbitraria porque tras reset puede perderse sincronía
            await this.enviarComando('45', ['T', 0]);
        } catch (e) {
            console.error('Fallo en recuperación', e);
        }
    }

    private async verificarEstado() {
        // Comando Status 0x38 [cite: 158]
        const resp = await this.enviarComando('38', ['N']); // N = Normal info
        if (!resp.exito) {
            throw new Error(`Estado de impresora inválido: ${resp.erroresDetectados.join(', ')}`);
        }
    }
}

// --- EJEMPLO DE USO ---

async function imprimirFacturaFiscal() {
    // Configurar puerto (Cambiar 'COM1' o '/dev/ttyUSB0' según corresponda)
    const fiscal = new ControladorFiscal('COM96', 9600);

    try {
        await fiscal.conectar();

        const cliente: DatosCliente = {
            razonSocial: "CLIENTE PRUEBA S.A.",
            rif: "V000000000"
        };

        const items: FacturaItem[] = [
            {
                descripcion: "Producto A",
                cantidad: 1000,      // Se enviará como "1.000"
                montoItem: 2000,    // Se enviará como "150.50"
                tasaImpositiva: 1600, // 16%
                calificador: "M"
            },
        ];

        const resultado = await fiscal.procesarFactura(cliente, items);
        console.log("Resultado Transacción:", resultado ? "EXITO" : "FALLO");

    } catch (error) {
        console.error("Error en aplicación:", error);
    } finally {
        await fiscal.desconectar();
    }
}

export { imprimirFacturaFiscal };