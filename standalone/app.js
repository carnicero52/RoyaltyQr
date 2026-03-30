// --- BASE DE DATOS LOCAL (LocalStorage) ---
// Esta lógica reemplaza a Firebase. Los datos se guardan en el archivo del navegador.

const DB = {
    save: (key, data) => localStorage.setItem(`fideliza_${key}`, JSON.stringify(data)),
    get: (key) => JSON.parse(localStorage.getItem(`fideliza_${key}`)) || [],
};

// --- ESTADO DE LA APLICACIÓN ---
let customers = DB.get('customers');
let businessConfig = JSON.parse(localStorage.getItem('fideliza_config')) || {
    name: "Mi Negocio Local",
    couponsNeeded: 10,
    currency: "$"
};

// --- FUNCIONES DE LÓGICA ---
function addCustomer(name, phone) {
    const newCustomer = {
        id: Date.now().toString(),
        name,
        phone,
        couponsCount: 0,
        createdAt: new Date().toISOString()
    };
    customers.push(newCustomer);
    DB.save('customers', customers);
    render();
}

function addStamp(customerId) {
    const customer = customers.find(c => c.id === customerId);
    if (customer) {
        customer.couponsCount++;
        customer.lastPurchaseAt = new Date().toISOString();
        DB.save('customers', customers);
        render();
        checkReward(customer);
    }
}

function checkReward(customer) {
    if (customer.couponsCount >= businessConfig.couponsNeeded) {
        alert(`¡PREMIO! ${customer.name} ha alcanzado sus ${businessConfig.couponsNeeded} sellos.`);
    }
}

// --- RENDERIZADO DE LA INTERFAZ ---
function render() {
    const app = document.getElementById('app');
    app.innerHTML = `
        <header class="mb-10 flex justify-between items-center">
            <div>
                <h1 class="text-3xl font-bold text-orange-600">${businessConfig.name}</h1>
                <p class="text-gray-500">Versión Local y Privada (Sin Nube)</p>
            </div>
            <div class="bg-orange-100 text-orange-700 px-4 py-2 rounded-full text-sm font-bold">
                ${customers.length} Clientes Registrados
            </div>
        </header>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
            <!-- Formulario de Registro -->
            <section class="card p-6">
                <h2 class="text-xl font-bold mb-4">Registrar Nuevo Cliente</h2>
                <div class="space-y-4">
                    <input id="new-name" type="text" placeholder="Nombre del Cliente" class="w-full p-3 border rounded-xl outline-none focus:ring-2 focus:ring-orange-500">
                    <input id="new-phone" type="text" placeholder="Teléfono" class="w-full p-3 border rounded-xl outline-none focus:ring-2 focus:ring-orange-500">
                    <button onclick="handleRegister()" class="w-full bg-orange-600 text-white font-bold py-3 rounded-xl hover:bg-orange-700 transition-colors">
                        Registrar Cliente
                    </button>
                </div>
            </section>

            <!-- Lista de Clientes -->
            <section class="card p-6">
                <h2 class="text-xl font-bold mb-4">Panel de Sellos</h2>
                <div class="space-y-3 max-h-[400px] overflow-y-auto">
                    ${customers.length === 0 ? '<p class="text-gray-400 text-center py-10">No hay clientes aún.</p>' : ''}
                    ${customers.map(c => `
                        <div class="flex items-center justify-between p-4 border rounded-xl hover:bg-gray-50 transition-colors">
                            <div>
                                <p class="font-bold">${c.name}</p>
                                <p class="text-xs text-gray-500">${c.phone}</p>
                                <div class="mt-2 flex gap-1">
                                    ${renderDots(c.couponsCount)}
                                </div>
                            </div>
                            <button onclick="addStamp('${c.id}')" class="bg-green-500 text-white p-2 rounded-lg hover:bg-green-600">
                                + Sello
                            </button>
                        </div>
                    `).join('')}
                </div>
            </section>
        </div>

        <footer class="mt-10 text-center text-gray-400 text-xs">
            Los datos se guardan localmente en este navegador. <br>
            Para una versión de escritorio real, se usaría una base de datos SQLite.
        </footer>
    `;
}

function renderDots(count) {
    let dots = '';
    const total = businessConfig.couponsNeeded;
    for (let i = 0; i < total; i++) {
        const active = i < count;
        dots += `<div class="w-3 h-3 rounded-full ${active ? 'bg-orange-500' : 'bg-gray-200'}"></div>`;
    }
    return dots;
}

function handleRegister() {
    const name = document.getElementById('new-name').value;
    const phone = document.getElementById('new-phone').value;
    if (name && phone) {
        addCustomer(name, phone);
        document.getElementById('new-name').value = '';
        document.getElementById('new-phone').value = '';
    }
}

// Iniciar la App
render();
