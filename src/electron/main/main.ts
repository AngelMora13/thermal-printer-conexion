import { join } from 'path';
import {
    app,
    BrowserWindow,
    ipcMain
} from 'electron';
import express from 'express'
import {PosPrinter, PosPrintData, PosPrintOptions} from '@3ksy/electron-pos-printer'
import {SerialPort} from 'serialport'
import { generarFacturaFiscal } from './printComand';
ipcMain.handle('obtener-impresoras', async () => {
  const win = BrowserWindow.getAllWindows()[0];
  return await win.webContents.getPrintersAsync()
});

const options: PosPrintOptions = {
    preview: false, // Preview in window or print
    margin: "0 0 0 0", // margin of content body
    copies: 1, // Number of copies to print
    printerName: 'Microsoft Print to PDF', // printerName: string, check it at webContent.getPrinters()
    timeOutPerLine: 400,
    silent: true,
    pageSize: '80mm',
    boolean: true
};
const data:PosPrintData[] = [{
      type: 'text',                                       // 'text' | 'barCode' | 'qrCode' | 'image' | 'table
      value: 'SAMPLE HEADING',
      style: {fontWeight: "700", textAlign: 'center', fontSize: "24px"}
  },]
const isDev = true
async function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
        preload: join(__dirname, '../preload/preload.js'),
        nodeIntegration: true,
    },
  });/*
  let printWindow = BrowserWindow.getFocusedWindow();
  console.log({printWindow}, 'prin')
  if(printWindow){
    let list = await printWindow.webContents.getPrintersAsync();
    console.log('list of Printers', list)
  }*/
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
  mainWindow.loadURL(join(__dirname, '../../index.html'));
}
let appExpress = express();
appExpress.use(express.json());

let server = appExpress.listen(8080);
appExpress.get('/getPrints', function(req, res){ 
  const priters=[
    {"name":"HP LaserJet Pro MFP M610"},
    {"name":"HP LaserJet Pro MFP k525"},
    {"name":"EPSON Termic Pro"},
  ]   
  return res.json(priters);      
});
appExpress.get('/print', function(req, res){ 
  console.log({data, options})
  PosPrinter.print(data, options)
 .then(console.log)
 .catch((error) => {
    console.error(error);
  });
  
  return res.json({status:"Impresion realizada"});      
});
app.whenReady().then(() => {
  createWindow()
  app.on('activate', function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
      app.quit();
  }
});

// serial port


const port = new SerialPort({
  path: 'COM3', // Cambia esto según el puerto detectado
  baudRate: 9600,
});

function enviarComando(comando: any) {
  return new Promise((resolve, reject) => {
    port.write(comando, (err) => {
      console.log({comando})
      if (err) reject(err);
      else resolve('Comando enviado correctamente');
    });
  });
}

appExpress.get('/listarImpresoras', async (req, res) => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    const impresoras = await win.webContents.getPrintersAsync();
    console.log(impresoras);
    res.json(impresoras);
  } catch (err: any) {
    res.status(500).send('Error al obtener impresoras: ' + err.message);
  }
});

// 🖨 /impresionPNP - Comandos binarios estilo PNP
/*appExpress.post('/impresionPNP', async (req, res) => {
  try {
    const comando = Buffer.from([
      0x20, // STX
      0x45, // Comando de impresión de línea
      0x01, // Subcomando
      ...Buffer.from('Texto de prueba PNP'), // Texto
      0x0D, // Carriage return
      0x03  // ETX
    ]);
    console.log('entrando')
    const resultado = await enviarComando(comando);
    console.log({resultado})
    res.send(resultado);
  } catch (err: any) {
    res.status(500).send('Error PNP: ' + err.message);
  }
});*/

// 🖨 /impresionHKA - Comandos ASCII estilo TFHKA
appExpress.post('/impresionHKA', async (req, res) => {
  try {
    const comandos = [
      '@FACTURA\r',
      '@REGITEM|Producto|100.00|1|16\r',
      '@TOTAL|EFECTIVO|100.00\r',
      '@CIERREZ\r'
    ];
    for (const cmd of comandos) {
      await enviarComando(cmd);
    }
    res.send('Comandos HKA enviados');
  } catch (err: any) {
    res.status(500).send('Error HKA: ' + err.message);
  }
});

// 🖨 /impresionEpson - Comandos ESC/POS estilo Epson/Bematech
appExpress.post('/impresionEpson', async (req, res) => {
  try {
    const comando = Buffer.from([
      0x1B, 0x40, // Inicializa impresora
      ...Buffer.from('Factura Epson\n'), // Texto
      0x0A // Salto de línea
    ]);
    const resultado = await enviarComando(comando);
    res.send(resultado);
  } catch (err: any) {
    res.status(500).send('Error Epson: ' + err.message);
  }
});

appExpress.post('/imprimirPDF', async (req, res) => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    console.log(req.body)
    const contenidoHTML = req.body.html || '<h1>Factura de prueba</h1><p>Cliente: Juan Pérez</p>';

    // Carga el contenido HTML en la ventana oculta
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(contenidoHTML)}`);

    // Imprime usando la impresora "Microsoft Print to PDF"
    win.webContents.print({
      silent: true,
      printBackground: true,
      deviceName: 'Microsoft Print to PDF',
      margins: {
        marginType: 'default' // o 'none', 'minimum'
      }
    }, (success, errorType) => {
      if (!success) {
        res.status(500).send('Error al imprimir: ' + errorType);
      } else {
        res.send('Impresión enviada a Microsoft Print to PDF');
      }
    });
  } catch (err: any) {
    res.status(500).send('Error general: ' + err.message);
  }
});

appExpress.get('/listarPuertosCom', async (req, res) => {
    try {
        const ports = await SerialPort.list(); // Aquí está la clave
        res.json(ports.map(p => ({ 
            path: p.path, // Esto será 'COM1', 'COM3', etc.
            manufacturer: p.manufacturer || 'Desconocido',
            p
        })));
    } catch (err: any) {
        res.status(500).send('Error al listar puertos: ' + err.message);
    }
});

/*
function calcularBCC(data: any) {
    let bcc = 0;
    // La operación XOR se realiza en todos los bytes, desde Sec hasta ETX (ambos incluidos).
    for (let i = 0; i < data.length; i++) {
        bcc ^= data[i];
    }
    return Buffer.from([bcc]);
}
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
                resolve('Comando binario enviado correctamente.');
            }
        });
    });
}
// Inicializa la conexión y ejecuta la impresión
port.on('open', imprimirDocumentoNoFiscal);

port.on('error', (err) => {
    console.error('Error de puerto serial:', err.message);
});
let secuencia = 0x20;
async function imprimirDocumentoNoFiscal() {
    try {
        // A. COMANDO: Abrir Documento No Fiscal (0x48)
        let comando_abrir = Buffer.from([
            secuencia++, // Sec (incrementar secuencia)
            0x48,        // Comando: Abrir Documento No Fiscal
            0x03         // ETX
        ]);
        await enviarComandoBinario(comando_abrir);

        // B. COMANDO: Imprimir Texto No Fiscal (0x49)
        const separador = 0x1C;
        const texto_imprimir = "PRUEBA DE COMUNICACION PNP"; 
        
        let comando_texto = Buffer.from([
            secuencia++,  // Sec (incrementar secuencia)
            0x49,         // Comando: Imprimir Texto No Fiscal
            separador,    // Separador
            ...Buffer.from(texto_imprimir, 'ascii'), // Texto en ASCII
            0x03          // ETX
        ]);
        await enviarComandoBinario(comando_texto);

        // C. COMANDO: Cerrar Documento No Fiscal (0x4A)
        let comando_cerrar = Buffer.from([
            secuencia++, // Sec (incrementar secuencia)
            0x4A,        // Comando: Cerrar Documento No Fiscal
            0x03         // ETX
        ]);
        await enviarComandoBinario(comando_cerrar);

        console.log('\n✅ Secuencia de impresión NO FISCAL completada.');

    } catch (error) {
        console.error('❌ Error en la secuencia de comandos:', error);
    } finally {
        // Cierra el puerto después de un tiempo para asegurar la transmisión
        setTimeout(() => port.close(), 2000);
    }
}*/

appExpress.post('/impresionPNP', (req, res) => {
    // Los datos de la factura se esperan en el cuerpo (body) de la solicitud POST
    const facturaData = {
      // La impresora fiscal maneja todos los cálculos, solo enviamos los datos.
        productos: [
            { nombre: "Jabon en barra", cantidad: 2.00, precioUnitario: 5.50, iva: 16.00 },
            { nombre: "Refresco 2L", cantidad: 1.00, precioUnitario: 3.25, iva: 16.00 },
            { nombre: "Pan Canilla", cantidad: 1.00, precioUnitario: 1.50, iva: 8.00 },
        ],
        pago: {
            tipo: 'Efectivo', // 'Efectivo', 'Cheque', 'Tarjeta', 'TDC', 'TDD', 'Otro'
            monto: 15.75, // Monto total de la factura
        }
    };
    //req.body; 

    if (!facturaData || !facturaData.productos) {
        return res.status(400).send({ error: "Datos de factura inválidos. Se requiere 'productos'." });
    }

    console.log('API Recibió solicitud de facturación para:', facturaData);

    // Llama a tu función de manejo serial.
    // La función debe ser modificada para aceptar facturaData y retornar una Promesa.
    generarFacturaFiscal(facturaData)
        .then(resultado => {
            // Envía la respuesta al cliente Electron
            res.status(200).send({ 
                success: true, 
                mensaje: "Comandos fiscales enviados. Revise impresora.", 
                detalles: resultado 
            });
        })
        .catch(error => {
            console.error('Error al facturar:', error);
            res.status(500).send({ 
                success: false, 
                error: error.message 
            });
        });
});