<script setup lang="ts">
import { ref } from 'vue';
import HelloWorld from './components/HelloWorld.vue'
const comPorts = ref<any>([]); // Variable reactiva para guardar la lista
const selectedComPort = ref(''); // Variable reactiva para la selección del usuario
// --- Variables para PNP Fiscal (NUEVAS) ---
const pnpComPorts = ref<any[]>([]); 
const selectedPnpComPort = ref(''); 
const facturaData = ref({ // Modelo de datos para la función 4
    razonSocial: 'CLIENTE DE PRUEBA RIF: J-12345678-0',
    rif: 'J-12345678-0',
    direccion: 'DIRECCIÓN DE PRUEBA',
    pagoDivisaMonto: 100.00, // Monto de pago en divisas para IGTF (si aplica)
    productos: [
        { descripcion: 'ITEM 1 (TASA 1)', cantidad: 1.00, precio: 50.00, tasaIva: 1 },
        { descripcion: 'ITEM 2 (TASA 3)', cantidad: 2.00, precio: 25.00, tasaIva: 3 } // Usar las tasas configuradas en tu impresora
    ]
});
/*********************************************** */

const getComPorts = async () => {
    try {
        const response = await fetch('http://localhost:8080/listarPuertosCom');
        const ports = await response.json();
        comPorts.value = ports; // Guarda la lista
        console.log('Puertos COM disponibles:', ports);
    } catch (error) {
        console.error('Error fetching COM ports:', error);
    }
};
const configurarPuerto = async () => {
    if (!selectedComPort.value) {
        console.error("Seleccione un puerto COM antes de configurar.");
        return;
    }
    
    try {
        const response = await fetch('http://localhost:8080/configurarPuerto', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({
                path: selectedComPort.value,
                // Puedes agregar aquí 'baudRate' si es configurable
            })
        });
        
        const result = await response.text();
        console.log(`Configuración de puerto COM exitosa: ${result}`);
        alert(`Puerto configurado a ${selectedComPort.value}. ¡Listo para imprimir!`);
        
    } catch (error) {
        console.error('Error al configurar el puerto COM:', error);
        alert('Error al configurar el puerto. Revise la consola del servidor.');
    }
}
const getPrinters = async () => {
  try {
    const response = await fetch('http://localhost:8080/listarImpresoras');
    const printers = await response.json();
    console.log(printers);
  } catch (error) {
    console.error('Error fetching printers:', error);
  }
};
const impresion = async (path: string) => {
  try {
    const response = await fetch('http://localhost:8080' + path, { method: 'POST' });
    const result = await response.text();
    console.log(result);
  } catch (error) {
    console.error('Error during printing:', error);
  }
}
const windowPrint = async () => {
  const response = await fetch('http://localhost:8080/imprimirPDF', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      html: '<h1>Factura</h1><p>Total: Bs. 100,00</p>'
    })
  });
  const result = await response.text();
  console.log(result);
}
/**************************************** */
// --- Nuevas Funciones para PNP Fiscal ---

// 1. Listar Puertos COM (PNP)
const getPnpComPorts = async () => {
    try {
        const response = await fetch('http://localhost:8080/pnp/listarPuertos');
        const ports = await response.json();
        pnpComPorts.value = ports; 
        console.log('Puertos COM disponibles PNP:', ports);
    } catch (error) {
        console.error('Error fetching COM ports PNP:', error);
        alert('Error al listar puertos PNP. Revisa la consola y el servidor Electron.');
    }
};

// 2. Seleccionar/Configurar Puerto COM (PNP)
const selectPnpComPort = async () => {
    if (!selectedPnpComPort.value) {
        console.error("Seleccione un puerto COM antes de configurar para PNP.");
        return;
    }
    
    try {
        const response = await fetch('http://localhost:8080/pnp/seleccionarPuerto', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: selectedPnpComPort.value,
            })
        });
        
        const result = await response.text();
        console.log(`Configuración de puerto COM PNP exitosa: ${result}`);
        alert(`Puerto configurado para PNP a ${selectedPnpComPort.value}. ¡Listo para imprimir!`);
    } catch (error) {
        console.error('Error al configurar puerto PNP:', error);
        alert('Error al configurar puerto PNP. Revisa la consola y el servidor Electron.');
    }
};

// 3. Impresión de Prueba (PNP - Documento No Fiscal)
const doTestPrintPnp = async () => {
    if (!selectedPnpComPort.value) {
        alert("Primero debe seleccionar y configurar un puerto COM PNP.");
        return;
    }

    try {
        const response = await fetch('http://localhost:8080/pnp/impresionPrueba', {
            method: 'POST'
        });
        
        const result = await response.text();
        console.log('Resultado Impresión de Prueba PNP:', result);
        alert(result);
    } catch (error) {
        console.error('Error en la impresión de prueba PNP:', error);
        alert('Error al realizar la impresión de prueba PNP. Revisa la consola y el servidor Electron.');
    }
};

// 4. Impresión de Factura Completa (PNP - Documento Fiscal)
const doPrintFacturaPnp = async () => {
    if (!selectedPnpComPort.value) {
        alert("Primero debe seleccionar y configurar un puerto COM PNP.");
        return;
    }
    
    try {
        const response = await fetch('http://localhost:8080/pnp/imprimirFactura', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(facturaData.value)
        });
        
        const result = await response.text();
        console.log('Resultado Impresión de Factura PNP:', result);
        alert(result);
    } catch (error) {
        console.error('Error al imprimir factura PNP:', error);
        alert('Error al imprimir factura PNP. Revisa la consola y el servidor Electron.');
    }
};
/**************************************************************** */
/***************************** */
const puertosCustom: any = ref([]);
const puertoSeleccionadoCustom = ref('');

const listarPuertosCustom = async () => {
  const res = await fetch('http://localhost:8080/custom/listarPuertos');
  puertosCustom.value = await res.json();
};

const configurarPuertoCustom = async () => {
  if (!puertoSeleccionadoCustom.value) return alert('Seleccione un puerto');
  const res = await fetch('http://localhost:8080/custom/seleccionarPuerto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: puertoSeleccionadoCustom.value })
  });
  alert(await res.text());
};

const impresionPruebaCustom = async () => {
  const res = await fetch('http://localhost:8080/custom/impresionPrueba', { method: 'POST' });
  alert(await res.text());
};

const imprimirFacturaCustom = async () => {
  const factura = {
    cliente: {
      razonSocial: 'Juan Pérez C.A.',
      rif: 'J-12345678-9',
      direccion: 'Av. Principal, Caracas'
    },
    productos: [
      { descripcion: 'Producto A', precio: '100.00', cantidad: '2', iva: '16' },
      { descripcion: 'Producto B', precio: '50.00', cantidad: '1', iva: '8' }
    ]
  };
  const res = await fetch('http://localhost:8080/custom/imprimirFactura', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(factura)
  });
  alert(await res.text());
};
const imprimirFacturaGem = async () => {
  const factura = {
    cliente: {
      razonSocial: 'Juan Pérez C.A.',
      rif: 'J-12345678-9',
      direccion: 'Av. Principal, Caracas'
    },
    productos: [
      { descripcion: 'Producto A', precio: '100.00', cantidad: '2', iva: '16' },
      { descripcion: 'Producto B', precio: '50.00', cantidad: '1', iva: '8' }
    ]
  };
  const res = await fetch('http://localhost:8080/pnp/imprimirFacturaGem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(factura)
  });
  alert(await res.text());
};
const imprimirFacturaGem2 = async () => {
  const factura = {
    cliente: {
      razonSocial: 'Juan Pérez C.A.',
      rif: 'J-12345678-9',
      direccion: 'Av. Principal, Caracas'
    },
    productos: [
      { descripcion: 'Producto A', precio: '100.00', cantidad: '2', iva: '16' },
      { descripcion: 'Producto B', precio: '50.00', cantidad: '1', iva: '8' }
    ]
  };
  const res = await fetch('http://localhost:8080/pnp/imprimirFacturaGem2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(factura)
  });
  alert(await res.text());
};
/******************************** */
</script>

<template>
  <div>
    <a href="https://vitejs.dev" target="_blank">
      <img src="/vite.svg" class="logo" alt="Vite logo" />
    </a>
    <a href="https://vuejs.org/" target="_blank">
      <img src="./assets/vue.svg" class="logo vue" alt="Vue logo" />
    </a>
  </div>
  <button @click="getPrinters">Listar Impresoras</button>
  <button @click="impresion('/impresionEpson')">Impresión Epson</button>
  <button @click="impresion('/impresionHKA')">Impresión HKA</button>
  <button @click="impresion('/impresionPNP')">Impresión PNP</button>.
  <button @click="windowPrint">Impresión PDF</button>
    <hr>
    <h2>Configuración Serial/Fiscal</h2>
    
    <button @click="getComPorts">Buscar Puertos COM</button>
    
    <select v-model="selectedComPort">
        <option value="" disabled>Seleccione un puerto</option>
        <option v-for="port in comPorts" :key="port?.path" :value="port?.path">
            {{ port?.path }} ({{ port?.manufacturer }})
        </option>
    </select>
    
    <button :disabled="!selectedComPort" @click="configurarPuerto">
        Configurar Puerto {{ selectedComPort }}
    </button>
    
    <button @click="impresion('/impresionHKA')">Impresión HKA</button>
    <button @click="impresion('/impresionPNP')">Impresión PNP</button>
    <hr>
    
    <h2>Configuración Serial/Fiscal (PNP) GEM</h2>
    
    <button @click="getPnpComPorts">1. Listar Puertos COM (PNP)</button>
    
    <select v-model="selectedPnpComPort">
        <option value="" disabled>Seleccione un puerto PNP</option>
        <option v-for="port in pnpComPorts" :key="port?.path" :value="port?.path">
            {{ port?.path }} ({{ port?.manufacturer }})
        </option>
    </select>
    
    <button :disabled="!selectedPnpComPort" @click="selectPnpComPort">
        2. Configurar Puerto PNP: **{{ selectedPnpComPort || 'Seleccione' }}**
    </button>
    
    <hr>
    <h3>Operaciones de Impresión (PNP)</h3>
    
    <button :disabled="!selectedPnpComPort" @click="doTestPrintPnp">
        3. Impresión de Prueba (DNF)
    </button>
    
    <button :disabled="!selectedPnpComPort" @click="doPrintFacturaPnp">
        4. Imprimir Factura Completa
    </button>

    <div>
        <h4>Datos de Factura de Prueba (usados en la Función 4)</h4>
        <p>Razón Social: <strong>{{ facturaData.razonSocial }}</strong></p>
        <p>RIF: <strong>{{ facturaData.rif }}</strong></p>
        <p>Productos: {{ facturaData.productos.length }} ítems (edita la data en App.vue si es necesario)</p>
        <p>Monto Pago Divisa (para IGTF): {{ facturaData.pagoDivisaMonto }}</p>
    </div><hr>
<h2>🧾 Funciones Fiscales Personalizadas cop</h2>
<button @click="listarPuertosCustom">Listar Puertos COM (Custom)</button>
<select v-model="puertoSeleccionadoCustom">
  <option disabled value="">Seleccione un puerto</option>
  <option v-for="port in puertosCustom" :key="port.path" :value="port.path">
    {{ port.path }} ({{ port.manufacturer }})
  </option>
</select>
<button @click="configurarPuertoCustom">Configurar Puerto</button>
<button @click="impresionPruebaCustom">Impresión de Prueba</button>
<button @click="imprimirFacturaCustom">Imprimir Factura</button>
<div>
  <h2>🧾 Funciones Fiscales PNP GEMINI</h2>
  <button @click="imprimirFacturaGem">Imprimir Factura GEMINI PRO</button>
  <button @click="imprimirFacturaGem2">Imprimir Factura GEMINI PRO 2</button>
</div>

</template>

<style scoped>
.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: filter 300ms;
}
.logo:hover {
  filter: drop-shadow(0 0 2em #646cffaa);
}
.logo.vue:hover {
  filter: drop-shadow(0 0 2em #42b883aa);
}
</style>
