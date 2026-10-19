// URL de tu Apps Script publicado.
const URL_API = 'https://script.google.com/macros/s/AKfycbwvDCLPQFjihn9Qqpv10G2fYANwJDcEu8FCGzyAf-2Q7OeVPhlfzyBisQjbCPjRAFD0og/exec';

// Gastos que se muestran en la lista.
const DIAS_A_MOSTRAR = 7;
// Días de historial que se descargan para el autocompletado y el
// aviso de monto raro (más que los 7 de la lista).
const DIAS_DE_HISTORIAL = 90;

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

// ---------- Utilidades ----------

const $ = (id) => document.getElementById(id);
const pesos = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' });

// Fecha de hace N días en formato AAAA-MM-DD (hora local del celular).
function haceDias(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// Fecha y hora actual, para ordenar los registros del mismo día.
function ahora() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${haceDias(0)}T${hh}:${mm}:${ss}`;
}

// "2026-10-17" → "Hoy", "Ayer" o "Miércoles, 14 oct"
function nombreDelDia(fechaISO) {
  if (fechaISO === haceDias(0)) return 'Hoy';
  if (fechaISO === haceDias(1)) return 'Ayer';
  const [a, m, d] = fechaISO.split('-').map(Number);
  const texto = new Date(a, m - 1, d).toLocaleDateString('es-CL', {
    weekday: 'long', day: 'numeric', month: 'short',
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Crea un elemento HTML. Usa textContent (no innerHTML) para que un
// concepto con caracteres raros nunca se interprete como código.
function crear(etiqueta, clase, texto) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

// Identificador único para cada registro: permite deshacer, editar
// y borrar exactamente esa fila en la hoja.
function nuevoId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function leerLocal(clave, porDefecto) {
  try {
    const valor = localStorage.getItem(clave);
    return valor ? JSON.parse(valor) : porDefecto;
  } catch {
    return porDefecto;
  }
}

function guardarLocal(clave, valor) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    // sin espacio o almacenamiento bloqueado: seguimos igual
  }
}

// ---------- Conexión con el Apps Script ----------

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

// Error que viene del Apps Script (por ejemplo "Token inválido").
// Se distingue de un error de red (sin señal), que se reintenta.
class ErrorDelServidor extends Error {}

async function leerRespuesta(respuesta) {
  const resultado = await respuesta.json();
  if (!resultado.ok) {
    if (resultado.error === 'Token inválido') {
      localStorage.removeItem('token'); // la próxima vez la pedirá de nuevo
    }
    throw new ErrorDelServidor(resultado.error);
  }
  return resultado;
}

const api = {
  // GET: movimientos de los últimos DIAS_DE_HISTORIAL días, con ID.
  async cargar() {
    const token = obtenerToken();
    if (!token) throw new ErrorDelServidor('Falta la clave');
    const url = `${URL_API}?token=${encodeURIComponent(token)}&ids=1&desde=${haceDias(DIAS_DE_HISTORIAL)}`;
    const resultado = await leerRespuesta(await fetch(url));
    // La hoja usa nombres con mayúscula; la app, con minúscula.
    return resultado.datos.map((d) => ({
      id: d.ID,
      fecha: d.Fecha,
      tipo: d.Tipo,
      categoria: d.Categoria,
      concepto: String(d.Concepto),
      monto: Number(d.Monto),
      registrado: d.Registrado || '',
    }));
  },

  // POST: crear, editar o borrar.
  async enviar(accion, mov) {
    const token = obtenerToken();
    if (!token) throw new ErrorDelServidor('Falta la clave');
    const respuesta = await fetch(URL_API, {
      method: 'POST',
      // "text/plain" evita una verificación extra del navegador (CORS)
      // que Apps Script no sabe responder. El contenido igual es JSON.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token, accion, ...mov }),
    });
    return leerRespuesta(respuesta);
  },

  guardar: (mov) => api.enviar('crear', mov),
  editar: (mov) => api.enviar('editar', mov),
  borrar: (id) => api.enviar('borrar', { id }),
};

// ---------- Estado de la app ----------

let movimientos = [];                          // lo que hay en la hoja
let pendientes = leerLocal('pendientes', []);  // guardados sin señal
let cargado = false;
let errorDeCarga = null;                       // mensaje si no se pudo cargar

const formulario = $('formulario');
const inputMonto = $('monto');
const selectCategoria = $('categoria');
const inputConcepto = $('concepto');
const inputFecha = $('fecha');
const botonGuardar = $('guardar');
const lista = $('lista');

const tipoElegido = () => formulario.querySelector('input[name="tipo"]:checked').value;

// ---------- Categorías ----------

function llenarSelect(select, tipo, elegida) {
  const opciones = CATEGORIAS[tipo];
  select.innerHTML = '';
  for (const nombre of opciones) {
    const opcion = document.createElement('option');
    opcion.value = nombre;
    opcion.textContent = nombre;
    select.appendChild(opcion);
  }
  select.value = opciones.includes(elegida) ? elegida : CATEGORIA_INICIAL[tipo];
}

// ---------- Monto con puntos ($15.000) ----------

function leerMonto(input) {
  return Number(input.value.replace(/\D/g, '').slice(0, 10));
}

function formatearMonto(input) {
  const monto = leerMonto(input);
  input.value = monto ? pesos.format(monto) : '';
}

// ---------- Autocompletar concepto ----------

// Junta los conceptos ya usados, del más frecuente al menos frecuente.
function llenarSugerencias(datalist, tipo) {
  const conteo = new Map(); // "micro" → { texto: "Micro", veces: 4 }
  for (const m of [...movimientos, ...pendientes]) {
    if (m.tipo !== tipo) continue;
    const clave = m.concepto.toLowerCase();
    const item = conteo.get(clave) || { texto: m.concepto, veces: 0 };
    item.veces++;
    conteo.set(clave, item);
  }
  datalist.innerHTML = '';
  [...conteo.values()]
    .sort((a, b) => b.veces - a.veces)
    .forEach(({ texto }) => {
      const opcion = document.createElement('option');
      opcion.value = texto;
      datalist.appendChild(opcion);
    });
}

// ---------- Aviso de monto raro ----------

function promedioHabitual(concepto, idExcluir) {
  const previos = movimientos.filter((m) =>
    m.tipo === 'Egreso' && m.id !== idExcluir &&
    m.concepto.toLowerCase() === concepto.toLowerCase());
  if (previos.length < 2) return null; // poco historial para comparar
  return previos.reduce((suma, m) => suma + m.monto, 0) / previos.length;
}

// Devuelve true si se puede guardar (el monto es normal o el usuario confirmó).
async function confirmarSiEsRaro(concepto, monto, idExcluir) {
  const promedio = promedioHabitual(concepto, idExcluir);
  if (promedio === null || monto < promedio * 3) return true;
  return preguntar({
    titulo: '¿Monto correcto?',
    mensaje: `Normalmente "${concepto}" te cuesta cerca de ${pesos.format(Math.round(promedio))} y escribiste ${pesos.format(monto)}.`,
    si: 'Sí, guardar',
    no: 'Corregir',
  });
}

// ---------- Ventana de pregunta (Sí / No) ----------

function preguntar({ titulo, mensaje, si, no, peligro = false }) {
  const dialogo = $('dialogo-pregunta');
  const botonSi = $('pregunta-si');
  const botonNo = $('pregunta-no');
  $('pregunta-titulo').textContent = titulo;
  $('pregunta-mensaje').textContent = mensaje;
  botonSi.textContent = si;
  botonNo.textContent = no;
  botonSi.className = peligro ? 'peligro-lleno' : '';

  return new Promise((resolver) => {
    const cerrar = (respuesta) => {
      botonSi.onclick = botonNo.onclick = dialogo.oncancel = null;
      dialogo.close();
      resolver(respuesta);
    };
    botonSi.onclick = () => cerrar(true);
    botonNo.onclick = () => cerrar(false);
    dialogo.oncancel = (e) => { e.preventDefault(); cerrar(false); }; // botón "atrás"
    dialogo.showModal();
  });
}

// ---------- Mensaje inferior con "Deshacer" ----------

let temporizadorToast;

function mostrarToast(texto, alDeshacer) {
  const boton = $('toast-deshacer');
  $('toast-texto').textContent = texto;
  boton.hidden = !alDeshacer;
  boton.onclick = alDeshacer ? () => { ocultarToast(); alDeshacer(); } : null;
  $('toast').hidden = false;
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(ocultarToast, alDeshacer ? 6000 : 4000);
}

function ocultarToast() {
  $('toast').hidden = true;
}

// Mensaje para errores al hablar con el Apps Script.
function textoDeError(err, siNoHaySenal) {
  return err instanceof ErrorDelServidor ? `Error: ${err.message}` : siNoHaySenal;
}

async function deshacer(mov) {
  if (pendientes.some((p) => p.id === mov.id)) {
    // Todavía no se había enviado: basta con sacarlo de la cola
    pendientes = pendientes.filter((p) => p.id !== mov.id);
    guardarLocal('pendientes', pendientes);
  } else {
    try {
      await api.borrar(mov.id);
      movimientos = movimientos.filter((m) => m.id !== mov.id);
    } catch (err) {
      mostrarToast(textoDeError(err, 'Sin señal: no se pudo deshacer. Edítalo desde la lista cuando vuelva la conexión.'));
      return;
    }
  }
  mostrarToast('Registro deshecho');
  actualizarTodo();
}

// ---------- Guardar un movimiento nuevo ----------

function avisarError(texto, campo) {
  mostrarToast(texto);
  campo.focus();
}

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault(); // evita que el navegador recargue la página

  const mov = {
    id: nuevoId(),
    fecha: inputFecha.value,
    tipo: tipoElegido(),
    categoria: selectCategoria.value,
    concepto: inputConcepto.value.trim(),
    monto: leerMonto(inputMonto),
    registrado: ahora(),
  };

  if (!mov.monto) return avisarError('Escribe un monto', inputMonto);
  if (!mov.concepto) return avisarError('Escribe un concepto', inputConcepto);
  if (!mov.fecha) return avisarError('Elige una fecha', inputFecha);

  if (mov.tipo === 'Egreso' && !(await confirmarSiEsRaro(mov.concepto, mov.monto))) {
    inputMonto.focus();
    return;
  }

  // Bloqueamos el botón para no enviar dos veces el mismo movimiento.
  botonGuardar.disabled = true;
  try {
    await api.guardar(mov);
    movimientos.push(mov);
    mostrarToast(`✓ Guardado: ${mov.concepto} (${pesos.format(mov.monto)})`, () => deshacer(mov));
  } catch (err) {
    if (err instanceof ErrorDelServidor) {
      // El Apps Script lo rechazó (clave, dato inválido): no se guarda
      mostrarToast(`Error: ${err.message}`);
      botonGuardar.disabled = false;
      return;
    }
    // Sin señal: queda en la cola del celular y se envía después
    pendientes.push(mov);
    guardarLocal('pendientes', pendientes);
    mostrarToast(`⏳ Sin señal: "${mov.concepto}" se enviará al volver la conexión`, () => deshacer(mov));
  } finally {
    botonGuardar.disabled = false;
  }

  inputMonto.value = '';
  inputConcepto.value = '';
  inputMonto.focus();
  actualizarTodo();
  enviarPendientes(); // si había otros en cola y ahora hay señal
});

// ---------- Editar o borrar un gasto ----------

let enEdicion = null;

function abrirEdicion(mov) {
  const { pendiente, ...limpio } = mov;
  enEdicion = limpio;
  $('editar-monto').value = pesos.format(mov.monto);
  llenarSelect($('editar-categoria'), 'Egreso', mov.categoria);
  $('editar-concepto').value = mov.concepto;
  $('editar-fecha').value = mov.fecha;
  $('dialogo-editar').showModal();
}

// Aplica un cambio en la cola (si no se ha enviado) o en la hoja.
async function aplicarCambio(mov, accion) {
  const i = pendientes.findIndex((p) => p.id === mov.id);
  if (i >= 0) {
    if (accion === 'borrar') pendientes.splice(i, 1);
    else pendientes[i] = mov;
    guardarLocal('pendientes', pendientes);
    actualizarTodo();
    return true;
  }
  try {
    if (accion === 'borrar') {
      await api.borrar(mov.id);
      movimientos = movimientos.filter((m) => m.id !== mov.id);
    } else {
      await api.editar(mov);
      movimientos = movimientos.map((m) => (m.id === mov.id ? mov : m));
    }
    actualizarTodo();
    return true;
  } catch (err) {
    mostrarToast(textoDeError(err, 'Necesitas señal para editar o borrar un gasto ya enviado.'));
    return false;
  }
}

$('editar-monto').addEventListener('input', (e) => formatearMonto(e.target));
$('editar-cancelar').addEventListener('click', () => $('dialogo-editar').close());

$('form-editar').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const cambiado = {
    ...enEdicion,
    monto: leerMonto($('editar-monto')),
    categoria: $('editar-categoria').value,
    concepto: $('editar-concepto').value.trim(),
    fecha: $('editar-fecha').value,
  };
  if (!cambiado.monto) return avisarError('Escribe un monto', $('editar-monto'));
  if (!cambiado.concepto) return avisarError('Escribe un concepto', $('editar-concepto'));
  if (!cambiado.fecha) return avisarError('Elige una fecha', $('editar-fecha'));
  if (!(await confirmarSiEsRaro(cambiado.concepto, cambiado.monto, cambiado.id))) return;

  if (await aplicarCambio(cambiado, 'editar')) {
    $('dialogo-editar').close();
    mostrarToast('✓ Cambios guardados');
  }
});

$('editar-eliminar').addEventListener('click', async () => {
  const mov = enEdicion;
  const seguro = await preguntar({
    titulo: '¿Eliminar este gasto?',
    mensaje: `"${mov.concepto}" por ${pesos.format(mov.monto)}. También desaparecerá de tu Excel la próxima vez que actualices.`,
    si: 'Eliminar',
    no: 'Cancelar',
    peligro: true,
  });
  if (!seguro) return;
  if (await aplicarCambio(mov, 'borrar')) {
    $('dialogo-editar').close();
    mostrarToast(`Eliminado: ${mov.concepto}`);
  }
});

// ---------- Enviar pendientes al volver la señal ----------

let enviando = false;

async function enviarPendientes() {
  if (enviando || pendientes.length === 0 || !navigator.onLine) return;
  enviando = true;
  let enviados = 0;
  try {
    while (pendientes.length) {
      const mov = pendientes[0];
      await api.guardar(mov); // si ya había llegado, el Apps Script no lo duplica
      pendientes.shift();
      guardarLocal('pendientes', pendientes);
      if (!movimientos.some((m) => m.id === mov.id)) movimientos.push(mov);
      enviados++;
    }
  } catch (err) {
    // Sin señal de nuevo: lo que queda se envía después.
    // Si el Apps Script rechazó algo, lo avisamos (queda en la cola).
    if (err instanceof ErrorDelServidor) mostrarToast(`No se pudo enviar un pendiente: ${err.message}`);
  }
  enviando = false;
  if (enviados) {
    mostrarToast(`✓ Se ${enviados === 1 ? 'envió 1 registro pendiente' : `enviaron ${enviados} registros pendientes`}`);
  }
  actualizarTodo();
}

function actualizarBanner() {
  const banner = $('conexion');
  const n = pendientes.length;
  const textoPendientes = n === 1 ? '1 pendiente' : `${n} pendientes`;
  if (!navigator.onLine) {
    banner.textContent = n
      ? `📶 Sin señal · ${textoPendientes} por enviar`
      : '📶 Sin señal · lo que registres se enviará después';
    banner.className = 'conexion sin-senal';
    banner.hidden = false;
  } else if (n) {
    banner.textContent = `⏳ ${textoPendientes} por enviar · toca ↻ para reintentar`;
    banner.className = 'conexion';
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

window.addEventListener('online', cargar); // recarga la lista y envía lo pendiente
window.addEventListener('offline', actualizarBanner);

// ---------- Lista de gastos de los últimos 7 días ----------

function filaDeGasto(g) {
  const fila = crear('button', 'gasto');
  fila.type = 'button';
  const info = crear('div', 'info');
  info.appendChild(crear('strong', null, g.concepto));
  const detalle = crear('span', null, g.categoria);
  if (g.pendiente) detalle.appendChild(crear('em', 'pendiente', ' · ⏳ Pendiente de envío'));
  info.appendChild(detalle);
  fila.appendChild(info);
  fila.appendChild(crear('span', 'monto', '−' + pesos.format(g.monto)));
  fila.addEventListener('click', () => abrirEdicion(g));
  return fila;
}

function mostrarGastos() {
  lista.innerHTML = '';
  const marcarPendiente = (p) => ({ ...p, pendiente: true });

  if (!cargado && !errorDeCarga) {
    lista.appendChild(crear('p', 'cargando', 'Cargando tus gastos…'));
    return;
  }

  // No se pudo cargar: aviso en vez de la lista (+ lo pendiente)
  if (errorDeCarga) {
    $('total-gastos').textContent = '—';
    const aviso = crear('div', 'aviso-sin-conexion');
    aviso.appendChild(crear('strong', null, errorDeCarga.titulo));
    aviso.appendChild(crear('span', null, errorDeCarga.detalle));
    lista.appendChild(aviso);
    const propios = pendientes.filter((p) => p.tipo === 'Egreso').map(marcarPendiente);
    if (propios.length) {
      const grupo = crear('div', 'dia');
      const cabecera = crear('div', 'dia-cabecera');
      cabecera.appendChild(crear('h3', null, 'Pendientes de envío'));
      grupo.appendChild(cabecera);
      propios.forEach((g) => grupo.appendChild(filaDeGasto(g)));
      lista.appendChild(grupo);
    }
    return;
  }

  const gastos = [...movimientos, ...pendientes.map(marcarPendiente)]
    .filter((m) => m.tipo === 'Egreso')
    .sort((a, b) => String(b.registrado).localeCompare(String(a.registrado)));

  // Recorremos los 7 días uno por uno, aunque alguno no tenga gastos.
  let total = 0;
  for (let i = 0; i < DIAS_A_MOSTRAR; i++) {
    const fecha = haceDias(i);
    const delDia = gastos.filter((g) => g.fecha === fecha);
    const subtotal = delDia.reduce((suma, g) => suma + g.monto, 0);
    total += subtotal;

    const grupo = crear('div', 'dia');
    const cabecera = crear('div', 'dia-cabecera');
    cabecera.appendChild(crear('h3', null, nombreDelDia(fecha)));
    cabecera.appendChild(crear('span', null, pesos.format(subtotal)));
    grupo.appendChild(cabecera);

    if (delDia.length === 0) {
      grupo.appendChild(crear('p', 'nada', 'No gastaste nada este día'));
    }
    delDia.forEach((g) => grupo.appendChild(filaDeGasto(g)));
    lista.appendChild(grupo);
  }
  $('total-gastos').textContent = pesos.format(total);
}

function actualizarTodo() {
  mostrarGastos();
  llenarSugerencias($('sugerencias'), tipoElegido());
  llenarSugerencias($('sugerencias-gastos'), 'Egreso');
  actualizarBanner();
}

// ---------- Cargar datos desde la hoja ----------

async function cargar() {
  const boton = $('actualizar');
  boton.classList.add('girando');
  try {
    movimientos = await api.cargar();
    cargado = true;
    errorDeCarga = null;
  } catch (err) {
    errorDeCarga = err instanceof ErrorDelServidor
      ? { titulo: '⚠️ No se pudo cargar', detalle: `${err.message}. Toca ↻ para intentar de nuevo.` }
      : { titulo: '📶 Sin conexión', detalle: 'No se pudieron cargar tus gastos. Toca ↻ cuando vuelva la señal.' };
  }
  boton.classList.remove('girando');
  actualizarTodo();
  enviarPendientes();
}

// ---------- Eventos del formulario ----------

inputMonto.addEventListener('input', () => formatearMonto(inputMonto));

// Cuando cambias entre Egreso e Ingreso, cambian las categorías.
formulario.addEventListener('change', (evento) => {
  if (evento.target.name === 'tipo') {
    llenarSelect(selectCategoria, evento.target.value);
    llenarSugerencias($('sugerencias'), evento.target.value);
  }
});

$('actualizar').addEventListener('click', cargar);

// ---------- Inicio ----------

inputFecha.value = haceDias(0);
llenarSelect(selectCategoria, tipoElegido());
actualizarTodo();
cargar();

// Registra el service worker (sw.js) para que la app sea instalable
// y abra sin internet.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}
