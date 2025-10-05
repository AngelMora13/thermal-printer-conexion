<script setup lang="ts">
import HelloWorld from './components/HelloWorld.vue'
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
