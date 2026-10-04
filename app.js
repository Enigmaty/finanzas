// URL de tu Apps Script publicado (Paso 2).
const URL_API = 'https://script.google.com/macros/s/AKfycbwvDCLPQFjihn9Qqpv10G2fYANwJDcEu8FCGzyAf-2Q7OeVPhlfzyBisQjbCPjRAFD0og/exec';

// Mismas listas que en el Apps Script y en la hoja "LV" de tu Excel.
const CATEGORIAS = {
  Ingreso: ['Sueldo', 'Negocio', 'Otros'],
  Egreso: ['Servicios', 'Gastos', 'Deudas', 'Ahorro'],
};

// Categoría que aparece elegida al abrir la app o al cambiar de tipo.
const CATEGORIA_INICIAL = {
  Ingreso: 'Sueldo',
  Egreso: 'Gastos',
};

// Guardamos referencias a los elementos del HTML que vamos a usar.
const formulario = document.getElementById('formulario');
const inputMonto = document.getElementById('monto');
const selectCategoria = document.getElementById('categoria');
const inputConcepto = document.getElementById('concepto');
const inputFecha = document.getElementById('fecha');
const botonGuardar = document.getElementById('guardar');
const estado = document.getElementById('estado');

// Rellena el <select> con las categorías del tipo elegido.
function cargarCategorias(tipo) {
  selectCategoria.innerHTML = '';
  for (const nombre of CATEGORIAS[tipo]) {
    const opcion = document.createElement('option');
    opcion.value = nombre;
    opcion.textContent = nombre;
    selectCategoria.appendChild(opcion);
  }
  selectCategoria.value = CATEGORIA_INICIAL[tipo];
}

// Fecha de hoy en formato AAAA-MM-DD, según la hora local del celular.
function hoy() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function tipoElegido() {
  return formulario.querySelector('input[name="tipo"]:checked').value;
}

// El token NO va escrito en el código: se pide una vez y queda
// guardado en el celular (localStorage).
function obtenerToken() {
  let token = localStorage.getItem('token');
  if (!token) {
    token = prompt('Ingresa tu clave (el TOKEN de tu Apps Script):');
    if (token) localStorage.setItem('token', token.trim());
  }
  return token ? token.trim() : null;
}

function mostrarEstado(mensaje, tipo) {
  estado.textContent = mensaje;
  estado.className = tipo; // "ok", "error" o "" (neutro)
}

// Envía el movimiento al Apps Script y devuelve su respuesta.
async function enviar(movimiento) {
  const respuesta = await fetch(URL_API, {
    method: 'POST',
    // "text/plain" evita una verificación extra del navegador (CORS)
    // que Apps Script no sabe responder. El contenido igual es JSON.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(movimiento),
  });
  return respuesta.json();
}

// Cuando cambias entre Egreso e Ingreso, cambian las categorías.
formulario.addEventListener('change', (evento) => {
  if (evento.target.name === 'tipo') {
    cargarCategorias(evento.target.value);
  }
});

// Cuando presionas "Guardar"...
formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault(); // ...evita que el navegador recargue la página

  const token = obtenerToken();
  if (!token) {
    mostrarEstado('Sin clave no se puede guardar.', 'error');
    return;
  }

  const movimiento = {
    token,
    fecha: inputFecha.value,
    tipo: tipoElegido(),
    categoria: selectCategoria.value,
    concepto: inputConcepto.value.trim(),
    monto: Number(inputMonto.value),
  };

  // Bloqueamos el botón para no enviar dos veces el mismo movimiento.
  botonGuardar.disabled = true;
  mostrarEstado('Guardando…', '');

  try {
    const resultado = await enviar(movimiento);

    if (resultado.ok) {
      mostrarEstado(`✓ Guardado: ${movimiento.concepto} ($${movimiento.monto.toLocaleString('es-CL')})`, 'ok');
      // Limpiamos solo monto y concepto; tipo, categoría y fecha
      // suelen repetirse en el siguiente registro.
      inputMonto.value = '';
      inputConcepto.value = '';
      inputMonto.focus();
    } else {
      if (resultado.error === 'Token inválido') {
        localStorage.removeItem('token'); // la próxima vez la pedirá de nuevo
      }
      mostrarEstado(`Error: ${resultado.error}`, 'error');
    }
  } catch (err) {
    // Llega aquí si no hay internet o la respuesta no es JSON.
    mostrarEstado('No se pudo conectar. Revisa tu internet e intenta de nuevo.', 'error');
  } finally {
    botonGuardar.disabled = false;
  }
});

// Estado inicial al abrir la app.
cargarCategorias(tipoElegido());
inputFecha.value = hoy();

// Registra el service worker (sw.js) para que la app sea instalable
// y abra sin internet.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}
