import { SerialPort } from 'serialport';
import express from 'express';

const appExpress = express();
appExpress.use(express.json());

let puertoFiscal: SerialPort | null = null;

// 1️⃣ Listar puertos COM
appExpress.get('/custom/listarPuertos', async (req, res) => {
  try {
    const ports = await SerialPort.list();
    res.json(ports.map(p => ({
      path: p.path,
      manufacturer: p.manufacturer || 'Desconocido'
    })));
  } catch (err: any) {
    res.status(500).send('Error al listar puertos: ' + err.message);
  }
});

// 2️⃣ Seleccionar puerto COM
appExpress.post('/custom/seleccionarPuerto', async (req, res) => {
  const { path } = req.body;
  if (!path) return res.status(400).send('Puerto COM requerido.');

  try {
    puertoFiscal = new SerialPort({ path, baudRate: 9600 });
    res.send(`Puerto ${path} configurado correctamente.`);
  } catch (err: any) {
    res.status(500).send('Error al abrir puerto: ' + err.message);
  }
});

// Función auxiliar para enviar comandos
function enviarComandoFiscal(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!puertoFiscal || !puertoFiscal.isOpen) {
      return reject('Puerto fiscal no configurado o cerrado.');
    }
    puertoFiscal.write(buffer, err => {
      if (err) reject(err);
      else resolve('Comando enviado correctamente.');
    });
  });
}

// 3️⃣ Impresión de prueba
appExpress.post('/custom/impresionPrueba', async (req, res) => {
  try {
    const comando = Buffer.from([
      0x02, 0x41, 0x01,
      ...Buffer.from('*** PRUEBA DE IMPRESIÓN ***'),
      0x0D, 0x03
    ]);
    const resultado = await enviarComandoFiscal(comando);
    res.send(resultado);
  } catch (err: any) {
    res.status(500).send('Error en impresión de prueba: ' + err.message);
  }
});

// 4️⃣ Imprimir factura completa
appExpress.post('/custom/imprimirFactura', async (req, res) => {
  const { cliente, productos } = req.body;
  if (!cliente || !productos || productos.length === 0) {
    return res.status(400).send('Datos incompletos para la factura.');
  }

  try {
    const comandos: Buffer[] = [];

    // Abrir factura
    comandos.push(Buffer.from([0x02, 0x40, 0x01, 0x0D, 0x03]));

    // Datos del cliente
    comandos.push(Buffer.from([0x02, 0x41, 0x01, ...Buffer.from(`Cliente: ${cliente.razonSocial}`), 0x0D, 0x03]));
    comandos.push(Buffer.from([0x02, 0x41, 0x01, ...Buffer.from(`RIF: ${cliente.rif}`), 0x0D, 0x03]));
    comandos.push(Buffer.from([0x02, 0x41, 0x01, ...Buffer.from(`Dirección: ${cliente.direccion}`), 0x0D, 0x03]));

    // Productos
    for (const prod of productos) {
      const linea = `${prod.descripcion}|${prod.precio}|${prod.cantidad}|${prod.iva}`;
      comandos.push(Buffer.from([0x02, 0x42, 0x01, ...Buffer.from(linea), 0x0D, 0x03]));
    }

    // Subtotal y cierre
    comandos.push(Buffer.from([0x02, 0x43, 0x01, 0x0D, 0x03]));
    comandos.push(Buffer.from([0x02, 0x45, 0x01, 0x0D, 0x03]));

    for (const cmd of comandos) {
      await enviarComandoFiscal(cmd);
    }

    res.send('Factura enviada correctamente.');
  } catch (err: any) {
    res.status(500).send('Error al imprimir factura: ' + err.message);
  }
});
