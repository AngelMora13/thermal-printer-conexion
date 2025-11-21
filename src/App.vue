<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

// Interfaces for document types
interface Factura {
    numeroFactura: number; // Número de la factura fiscal
    serialMaquina: string; // Serial de la máquina fiscal
    fecha: string;        // Formato String es indiferente el formato, quizas DD/MM/AA
    hora: string;         // Formato String es indiferente el formato, quizas HH:MM
}

interface NotaCredito {
    numeroFactura: string;
    serialMaquina: string;
    fecha: string;
    hora: string;
}

// Reactive variables for the billing interface
const printerPorts = ref<any[]>([]);
const selectedPrinterPort = ref('COM96');
const documentType = ref<'factura' | 'notaCredito'>('factura'); // Default to factura

const invoiceForm = ref({
    rif: 'V23235235',
    razonSocial: 'PRUEBA DE FACTURA FISCAL',
    items: [
        { nombre: '', cantidad: 1, precioUnitario: 0.00, excento: false },
    ],
    igtf: false, // New field for IGTF
    divisas: 0.00, // New field for divisas
    // Credit note fields
    notaCredito: {
        numeroFactura: '',
        serialMaquina: '',
        fecha: '',
        hora: ''
    } as NotaCredito
});

// Computed properties for calculations
const subtotalItems = computed(() => {
    return invoiceForm.value.items.reduce((sum, item) => {
        return sum + item.cantidad * item.precioUnitario;
    }, 0);
});

const totalImpuesto = computed(() => {
    return invoiceForm.value.items.reduce((sum, item) => {
        if (!item.excento) {
            return sum + (item.cantidad * item.precioUnitario * 0.16);
        }
        return sum;
    }, 0);
});

const totalFactura = computed(() => {
    return subtotalItems.value + totalImpuesto.value;
});

// Functions to add/remove items
const addItem = () => {
    invoiceForm.value.items.push({ nombre: '', cantidad: 1, precioUnitario: 0.00, excento: false });
};

const addPreFilledItem = () => {
    const newItemIndex = invoiceForm.value.items.length + 1;
    invoiceForm.value.items.push({
        nombre: `Producto [${newItemIndex}]`,
        cantidad: 1,
        precioUnitario: 1000.00,
        excento: false
    });
};

const removeItem = (index: number) => {
    invoiceForm.value.items.splice(index, 1);
};

// Existing functions, adapted for the new context
const getPrinterComPorts = async () => {
    try {
        const response = await fetch('http://localhost:8080/listarPuertosCom');
        const ports = await response.json();
        printerPorts.value = ports;
        console.log('Puertos COM disponibles:', ports);
    } catch (error) {
        console.error('Error fetching COM ports:', error);
    }
};

onMounted(() => {
    getPrinterComPorts();
});

// Function to handle printing the invoice
const handlePrintInvoice = async () => {
    if (!selectedPrinterPort.value) {
        alert("Primero debe seleccionar y configurar un puerto COM.");
        return;
    }

    if (documentType.value === 'factura') {
        if (invoiceForm.value.igtf && invoiceForm.value.divisas <= 0) {
            alert("Si aplica IGTF, el monto en divisas debe ser mayor a 0.");
            return;
        }

        const factura = {
            portName: selectedPrinterPort.value,
            cliente: {
                razonSocial: invoiceForm.value.razonSocial.substring(0, 38), // Max 38 characters
                rif: invoiceForm.value.rif.substring(0, 12),               // Max 12 characters
                igtf: invoiceForm.value.igtf,                              // Include IGTF status
                divisas: Math.round(invoiceForm.value.divisas * 100),      // Include divisas, formatted
            },
            productos: invoiceForm.value.items.map(item => ({
                descripcion: item.nombre.substring(0, 20),                     // Max 20 characters
                cantidad: Math.round(item.cantidad * 1000),                     // e.g., 2 -> 200, 0.2 -> 20
                montoItem: Math.round(item.precioUnitario * 100), // Monto sin impuesto, formato igual a cantidad
                tasaImpositiva: item.excento ? 0 : 1600                        // 0 for excento, 1600 for 16% IVA
            }))
        };

        try {
            const res = await fetch('http://localhost:8080/print/factura', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(factura)
            });
            alert(await res.text());
        } catch (error) {
            console.error('Error al imprimir factura:', error);
            alert('Error al imprimir factura. Revise la consola del servidor.');
        }
    } else { // documentType.value === 'notaCredito'
        // Validate credit note fields
        const nc = invoiceForm.value.notaCredito;
        if (!nc.numeroFactura || !nc.serialMaquina || !nc.fecha || !nc.hora) {
            alert("Todos los campos de la nota de crédito son obligatorios.");
            return;
        }

        const notaCreditoData = {
            portName: selectedPrinterPort.value,
            notaCredito: {
                numeroFactura: nc.numeroFactura,
                serialMaquina: nc.serialMaquina,
                fecha: nc.fecha,
                hora: nc.hora,
                // You might need to include items here as well, depending on the credit note API
                // For now, assuming credit note generation might not need all invoice details
                // This would be an area to clarify with the user/API spec
            },
            // Optionally include client and products if the credit note API requires them
            cliente: {
                razonSocial: invoiceForm.value.razonSocial.substring(0, 38),
                rif: invoiceForm.value.rif.substring(0, 12),
                igtf: invoiceForm.value.igtf,                              // Include IGTF status
                divisas: Math.round(invoiceForm.value.divisas * 100),      // Include divisas, formatted
            },
            productos: invoiceForm.value.items.map(item => ({
                descripcion: item.nombre.substring(0, 20),
                cantidad: Math.round(item.cantidad * 1000),
                montoItem: Math.round(item.precioUnitario * 100),
                tasaImpositiva: item.excento ? 0 : 1600
            }))
        };

        try {
            // Assuming a different endpoint for credit notes
            const res = await fetch('http://localhost:8080/print/factura', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(notaCreditoData)
            });
            alert(await res.text());
        } catch (error) {
            console.error('Error al generar nota de crédito:', error);
            alert('Error al generar nota de crédito. Revise la consola del servidor.');
        }
    }
};
</script>

<template>
<div class="invoice-container">
    <div class="invoice-header">
        <h1>{{ documentType === 'factura' ? 'Factura' : 'Nota de Crédito' }}</h1>
    </div>

    <div class="invoice-details">
        <div class="document-selector-and-port">
            <div class="printer-port-group">
                <label for="printer-port">Puerto de la impresora:</label>
                <div class="printer-port-inputs">
                    <input type="text" id="printer-port" v-model="selectedPrinterPort" placeholder="Ej: COM1 o /dev/ttyUSB0" />
                    <button class="add-item-btn" @click="getPrinterComPorts">Listar Puertos COM</button>
                </div>
                <select v-if="printerPorts.length > 0" v-model="selectedPrinterPort">
                    <option value="" disabled>Seleccione un puerto de la lista</option>
                    <option v-for="port in printerPorts" :key="port?.path" :value="port?.path">
                        {{ port?.path }} ({{ port?.manufacturer }})
                    </option>
                </select>
            </div>
            <div class="document-type-group">
                <label>Tipo de Documento:</label>
                <div class="document-type-selector">
                    <label>
                        <input type="radio" value="factura" v-model="documentType" /> Factura
                    </label>
                    <label>
                        <input type="radio" value="notaCredito" v-model="documentType" /> Nota de Crédito
                    </label>
                </div>
            </div>
        </div>

        <!-- Invoice and Credit Note Forms -->
        <div class="form-row">
            <div class="form-group">
                <label for="rif">RIF:</label>
                <input type="text" id="rif" v-model="invoiceForm.rif" placeholder="J-12345678-0" />
            </div>
            <div class="form-group">
                <label for="razonSocial">Razón social:</label>
                <input type="text" id="razonSocial" v-model="invoiceForm.razonSocial" placeholder="RAZÓN SOCIAL DE EJEMPLO" />
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label for="igtf">Aplicar IGTF:</label>
                <input type="checkbox" id="igtf" v-model="invoiceForm.igtf" />
            </div>
            <div class="form-group">
                <label for="divisas">Monto en Divisas:</label>
                <input type="number" id="divisas" v-model.number="invoiceForm.divisas" min="0" step="0.01" :disabled="!invoiceForm.igtf" />
            </div>
        </div>

        <div v-if="documentType === 'notaCredito'">
            <h2>Datos de la Nota de Crédito</h2>
            <div class="form-row">
                <div class="form-group">
                    <label for="nc-numeroFactura">Número de Factura:</label>
                    <input type="text" id="nc-numeroFactura" v-model="invoiceForm.notaCredito.numeroFactura" />
                </div>
                <div class="form-group">
                    <label for="nc-serialMaquina">Serial de Máquina:</label>
                    <input type="text" id="nc-serialMaquina" v-model="invoiceForm.notaCredito.serialMaquina" />
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label for="nc-fecha">Fecha (AAAAMMDD):</label>
                    <input type="text" id="nc-fecha" v-model="invoiceForm.notaCredito.fecha" placeholder="Ej: 20231026" />
                </div>
                <div class="form-group">
                    <label for="nc-hora">Hora (HHMMSS):</label>
                    <input type="text" id="nc-hora" v-model="invoiceForm.notaCredito.hora" placeholder="Ej: 143000" />
                </div>
            </div>
        </div>
    </div>

    <div class="invoice-items">
        <h2>Items</h2>
        <table>
            <thead>
                <tr>
                    <th>Nombre de producto</th>
                    <th>Cantidad</th>
                    <th>Precio unitario</th>
                    <th>Excento</th>
                    <th>Total producto</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(item, index) in invoiceForm.items" :key="index">
                    <td><input type="text" v-model="item.nombre" /></td>
                    <td><input type="number" v-model.number="item.cantidad" min="1" /></td>
                    <td><input type="number" v-model.number="item.precioUnitario" min="0" step="0.01" /></td>
                    <td><input type="checkbox" v-model="item.excento" /></td>
                    <td>{{ (item.cantidad * item.precioUnitario).toFixed(2) }}</td>
                    <td><button class="remove-item-btn" @click="removeItem(index)">X</button></td>
                </tr>
            </tbody>
        </table>
        <button class="add-item-btn" @click="addItem">Agregar Item</button>
        <button class="add-item-btn" @click="addPreFilledItem" style="margin-left: 10px;">Agregar Item Pre-llenado</button>
    </div>

    <div class="invoice-summary">
        <div>
            <span>Total productos (antes de impuesto):</span>
            <span>{{ subtotalItems.toFixed(2) }}</span>
        </div>
        <div>
            <span>Total del impuesto (IVA 16%):</span>
            <span>{{ totalImpuesto.toFixed(2) }}</span>
        </div>
        <div class="total-row">
            <span>Total Factura:</span>
            <span>{{ totalFactura.toFixed(2) }}</span>
        </div>
    </div>

    <div class="invoice-actions">
        <button class="print-btn" @click="handlePrintInvoice">
            {{ documentType === 'factura' ? 'Imprimir Factura' : 'Generar Nota de Crédito' }}
        </button>
    </div>
</div>
</template>

<style scoped>
.invoice-container {
    max-width: 800px;
    width: 95%; /* Make it responsive */
    margin: 40px auto;
    padding: 20px; /* Reduced padding for smaller screens */
    border: 1px solid #eee;
    box-shadow: 0 0 10px rgba(0, 0, 0, .15);
    font-size: 16px;
    line-height: 24px;
    font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif;
    color: #555;
    background-color: #fff;
    box-sizing: border-box; /* Include padding and border in the element's total width and height */
}

.invoice-header, .invoice-details, .invoice-items, .invoice-summary, .invoice-actions {
    margin-bottom: 20px;
}

.invoice-header h1 {
    font-size: 36px;
    color: #333;
    text-align: center;
    margin-bottom: 20px;
}

.document-selector-and-port {
    display: flex;
    flex-wrap: wrap; /* Allow wrapping on smaller screens */
    gap: 20px; /* Space between the two main sections */
    margin-bottom: 10px; /* Reduced margin-bottom */
    align-items: center; /* Vertically align items for single line appearance */
}

.document-type-group {
    flex: 1; /* Allow to take available space */
    min-width: 280px; /* Ensure it doesn't get too small */
    display: flex; /* Make the group a flex container */
    flex-direction: column; /* Stack label and radio buttons vertically */
    align-items: center; /* Align label and radio buttons horizontally */
    gap: 10px; /* Space between label and radio buttons */
}

.printer-port-group {
    flex: 1; /* Allow to take available space */
    min-width: 280px; /* Ensure it doesn't get too small */
    display: flex; /* Keep flex for label-inputs-select stacking */
    flex-direction: column; /* Stack label, inputs, and select vertically */
    gap: 5px; /* Reduced gap */
}

.printer-port-inputs {
    display: flex;
    gap: 10px; /* Space between input and button */
    margin-bottom: 5px; /* Reduced margin-bottom */
}

.printer-port-inputs input {
    flex: 1; /* Input takes available space */
}

.form-row {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    margin-bottom: 5px; /* Reduced vertical spacing */
}

.form-row .form-group {
    flex: 1; /* Each form group takes equal space in a row */
    min-width: 200px; /* Minimum width for each field before wrapping */
    margin-bottom: 0; /* Remove bottom margin from form-group if it's inside a form-row */
}

.form-group {
    margin-bottom: 5px; /* Reduced vertical spacing */
}

.form-group label {
    display: block;
    margin-bottom: 3px; /* Slightly reduced margin for labels */
    font-weight: bold;
}

.form-group input[type="text"],
.form-group input[type="number"],
.form-group select {
    width: 100%;
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
    box-sizing: border-box;
    min-width: 0; /* Allow input to shrink on small screens */
}

.form-group select {
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    background-image: url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23000000%22%20d%3D%22M287%2C197.399L146.2%2C56.6C142.3%2C52.7%2C136.2%2C52.7%2C132.3%2C56.6L5.499%2C193.4c-3.9%2C3.9-3.9%2C10.2%2C0%2C14.1s10.2%2C3.9%2C14.1%2C0l126.3-126.3l126.3%2C126.3c3.9%2C3.9%2C10.2%2C3.9%2C14.1%2C0S290.9%2C201.299%2C287%2C197.399z%22%2F%3E%3C%2Fsvg%3E');
    background-repeat: no-repeat;
    background-position: right 10px top 50%;
    background-size: 12px;
    padding-right: 30px;
}

table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 20px;
    display: block; /* Make table responsive by forcing scroll */
    overflow-x: auto; /* Enable horizontal scrolling */
    white-space: nowrap; /* Prevent text wrapping inside table cells */
}

table th, table td {
    border: 1px solid #eee;
    padding: 10px;
    text-align: left;
}

table th {
    background-color: #f2f2f2;
    font-weight: bold;
}

.total-row {
    font-weight: bold;
}

.add-item-btn, .remove-item-btn, .print-btn {
    background-color: #007bff;
    color: white;
    padding: 10px 15px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 16px;
    margin-top: 5px; /* Consistent smaller margin */
}

/* Specific adjustment for the "Listar Puertos COM" button */
.printer-port-inputs .add-item-btn {
    margin-top: 0; /* Align button with the input field */
}

.add-item-btn:hover, .print-btn:hover {
    background-color: #0056b3;
}

.remove-item-btn {
    background-color: #dc3545;
    margin-left: 10px;
}

.remove-item-btn:hover {
    background-color: #c82333;
}

.invoice-summary div {
    display: flex;
    flex-wrap: wrap; /* Allow items to wrap on smaller screens */
    justify-content: space-between;
    padding: 5px 0;
    border-bottom: 1px dashed #eee;
}

@media (max-width: 600px) {
    .invoice-container {
        margin: 20px auto;
        padding: 15px;
    }

    .invoice-header h1 {
        font-size: 28px;
    }

    table th, table td {
        padding: 8px;
    }

    .form-group {
        margin-bottom: 10px;
    }

    .add-item-btn, .remove-item-btn, .print-btn {
        width: 100%;
        margin-left: 0;
        margin-top: 5px;
    }

    .document-selector-and-port {
        flex-direction: column; /* Stack document type and printer port vertically on small screens */
        gap: 10px; /* Reduced gap */
    }

    .document-type-group {
        flex-direction: column; /* Stack label and radio buttons vertically */
        align-items: flex-start;
    }

    .printer-port-group {
        flex-direction: column; /* Stack label, input, and select vertically */
        align-items: flex-start;
    }

    .printer-port-inputs {
        flex-direction: column; /* Stack printer port input and button vertically on small screens */
        gap: 5px;
        width: 100%; /* Take full width */
    }

    .form-row {
        flex-direction: column; /* Stack form groups vertically on small screens */
        gap: 10px;
    }
}

.invoice-summary div:last-child {
    border-bottom: none;
    font-size: 1.2em;
    font-weight: bold;
}

/* Specific styles for document type selector radio buttons */
.document-type-selector {
    display: flex;
    gap: 15px;
    margin-top: 0; /* Remove top margin as it's now flex-aligned within its group */
}

.document-type-selector label {
    display: flex;
    align-items: center;
    font-weight: normal;
    margin-bottom: 0;
}

.document-type-selector input[type="radio"] {
    width: auto;
    margin-right: 5px;
}
</style>

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
