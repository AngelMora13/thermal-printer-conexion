<script setup lang="ts">
import { ref } from 'vue';
import HelloWorld from './components/HelloWorld.vue'
const comPorts = ref([]); // Variable reactiva para guardar la lista
const selectedComPort = ref(''); // Variable reactiva para la selección del usuario

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
const impresion = async (path) => {
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
