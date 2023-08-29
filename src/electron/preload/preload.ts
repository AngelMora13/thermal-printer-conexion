import express from 'express'
import { exec } from 'child_process';

window.addEventListener('DOMContentLoaded', () => {
  exec('wmic printer list brief', (err, stdout:any, stderr) => {
    if (err) {
        // node couldn't execute the command
        return;
    }
    // list of printers with brief details
    console.log(stdout);
  });

  const replaceText = (selector:any, text:any) => {
    const element = document.getElementById(selector)
    if (element) element.innerText = text
  }

  for (const dependency of ['chrome', 'node', 'electron']) {
    replaceText(`${dependency}-version`, process.versions[dependency])
  }

  let app = express();
  let server = app.listen(8080);
  app.get('/', function(req, res){    
      res.send('Server is ready!');      
  });
})