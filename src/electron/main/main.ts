import { join } from 'path';
import {
    app,
    BrowserWindow
} from 'electron';

const isDev = true
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
        preload: join(__dirname, '../preload/preload.js'),
        nodeIntegration: true,
    },
  });
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
  mainWindow.loadURL(join(__dirname, '../../index.html'));
}
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