const SerialPort = require('serialport');
const Readline = require('@serialport/parser-readline');

// Configuración del puerto COM3
const port = new SerialPort('COM96', { baudRate: 9600 });
const parser = port.pipe(new Readline({ delimiter: '\x03' })); // ETX como delimitador

let secuencia = 0x21;
let cola: any = [];
let esperando = false;

// Datos del cliente y productos
const cliente = {
  rif: 'J-12345678-9',
  razonSocial: 'Comercial XYZ, C.A.',
  direccion: 'Av. Principal, Edif. Fiscal, Caracas'
};

const productos = [
  { descripcion: 'Aceite de motor 1L', cantidad: 2, precio: 5.00, tasa: 16 },
  { descripcion: 'Filtro de aire', cantidad: 1, precio: 8.50, tasa: 16 }
];

// Construir comando fiscal
function construirComando(secuencia: number, comando: number, campos: any = []) {
  const STX = String.fromCharCode(0x02);
  const ETX = String.fromCharCode(0x03);
  const SEP = String.fromCharCode(0x1C);
  let cuerpo = STX + String.fromCharCode(secuencia) + String.fromCharCode(comando);
  if (campos.length) cuerpo += SEP + campos.join(SEP);
  cuerpo += ETX;

  let bcc = 0;
  for (let i = 0; i < cuerpo.length; i++) bcc += cuerpo.charCodeAt(i);
  const bccHex = bcc.toString(16).padStart(4, '0').toUpperCase();
  return cuerpo + bccHex;
}

// Encolar comando
function encolar(comando: string) {
  cola.push(comando);
  procesarCola();
}

// Procesar cola secuencialmente
function procesarCola() {
  if (esperando || cola.length === 0) return;
  esperando = true;
  const comando = cola.shift();
  port.write(comando, (err: any) => {
    if (err) console.error('Error al enviar:', err.message);
    else console.log('Comando enviado:', comando);
  });
}

// Validar respuesta fiscal
function validarRespuesta(data: any) {
  const campos = data.split(String.fromCharCode(0x1C));
  const estadoImpresora = campos[1] || '';
  const estadoFiscal = campos[2] || '';

  if (estadoImpresora.includes('ERROR') || estadoFiscal.includes('ERROR')) {
    console.error('⚠️ Error fiscal o de impresora:', estadoImpresora, estadoFiscal);
  } else {
    console.log('✅ Estado OK:', estadoImpresora, estadoFiscal);
  }
}

// Escuchar respuesta
parser.on('data', (data: any) => {
  console.log('📨 Respuesta recibida:', data);
  validarRespuesta(data);
  esperando = false;
  setTimeout(procesarCola, 100); // Pausa antes del siguiente comando
});

// Flujo de impresión fiscal
function imprimirFactura() {
  encolar(construirComando(secuencia++, 0x40, [cliente.rif, cliente.razonSocial])); // Abrir factura
  encolar(construirComando(secuencia++, 0x41, ['Venta de repuestos automotrices'])); // Texto adicional
  encolar(construirComando(secuencia++, 0x41, [cliente.direccion])); // Dirección

  productos.forEach(p => {
    const campos = [p.descripcion, p.cantidad.toFixed(2), p.precio.toFixed(2), p.tasa.toString()];
    encolar(construirComando(secuencia++, 0x42, campos)); // Ítem
  });

  encolar(construirComando(secuencia++, 0x43)); // Subtotal
  encolar(construirComando(secuencia++, 0x45, ['EFECTIVO', '0.00'])); // Cerrar factura
}
export { imprimirFactura };