import express from 'express'
import { exec } from 'child_process'
import { getDeviceList } from 'usb';

async function getPrints() {
  const devices = getDeviceList()
  const listPrint = devices[0] && devices.map(device =>{
    const imanufacturer = device.deviceDescriptor.iManufacturer
    device.getStringDescriptor(imanufacturer, (err, manufacturer) => {
      if (err) return 
      // print manufacturer
      console.log(manufacturer)
    
    })
    return{
      vendedorId:device.deviceDescriptor.idVendor,
      productoId:device.deviceDescriptor.idProduct,
      //name:nameProduct,

    }
  })
  console.log({listPrint})
  
}
getPrints()
window.addEventListener('DOMContentLoaded', () => {
  const prueba = exec('wmic printer list brief', (err, stdout:any, stderr) => {
    if (err) {
        // node couldn't execute the command
        return;
    }
    // list of printers with brief details
    console.log('1',stdout);
    stdout = stdout.split("  ");
    var printers = [];
    let j = 0;
    stdout = stdout.filter((item:any) => item);
    for (let i = 0; i < stdout.length; i++) {
        if (stdout[i] == " \r\r\n" || stdout[i] == "\r\r\n") {
            printers[j] = stdout[i + 1];
            j++;
        }
    }
    // list of only printers name
    console.log('imprimibles',printers);
    console.log('algo',stderr);
    return printers
  });
  console.log('prueba',prueba);
  /*const replaceText = (selector:any, text:any) => {
    const element = document.getElementById(selector)
    if (element) element.innerText = text
  }

  for (const dependency of ['chrome', 'node', 'electron']) {
    replaceText(`${dependency}-version`, process.versions[dependency])
  }*/

  let app = express();
  let server = app.listen(8080);
  app.get('/getPrints', function(req, res){ 
    const priters=[
      {"name":"HP LaserJet Pro MFP M610"},
      {"name":"HP LaserJet Pro MFP k525"},
      {"name":"EPSON Termic Pro"},
    ]   
    return res.json(priters);      
  });
  app.get('/print', function(req, res){ 
    
    return res.json({status:"Impresion realizada"});      
  });
})