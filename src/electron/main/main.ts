import { join } from 'path';
import {
    app,
    BrowserWindow
} from 'electron';
import express from 'express'
import {SerialPort} from 'serialport'
import { imprimirFacturaFiscal as imprimirFactura } from './printGeminisPro'

const isDev = true
async function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
        preload: join(__dirname, '../preload/preload.js'),
        nodeIntegration: true,
    },
  });
  if (isDev) {
    mainWindow.maximize();
    mainWindow.webContents.openDevTools();
  }
  mainWindow.loadURL(join(__dirname, '../../index.html'));
  // produccion quzias
  // mainWindow.loadFile('dist/index.html')
}
let appExpress = express();
appExpress.use(express.json());

let server = appExpress.listen(8080);
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

appExpress.post('/print/factura', async (req, res) => {
    const facturaData: any = req.body;

    try {
        const result = await imprimirFactura(facturaData)
        res.send(result);
    } catch (err: any) {
        console.error('Error al imprimir factura PNP:', err);
        res.status(500).send('Error al imprimir factura: ' + err.message);
    }
});