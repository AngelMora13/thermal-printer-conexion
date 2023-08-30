import { join } from 'path';
import {
    app,
    BrowserWindow,
} from 'electron';
import express from 'express'
import {PosPrinter, PosPrintData, PosPrintOptions} from '@3ksy/electron-pos-printer'

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