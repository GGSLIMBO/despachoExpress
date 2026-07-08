import { zonas } from './data/zonas.js';
import { normalizar } from './utils/helpers.js';
import { getHistorial, saveHistorial } from './services/storage.js';
import { analyzePDF } from './services/pdfAnalyzer.js';

// Module-scoped state
const clientesFrecuentes = ["Awatto", "Kar Pe", "Bookin"];
let contadores = { 'GBA 1': 0, 'GBA 2': 0, 'Zonas Lejanas': 0, 'CABA': 0 };
let registroEditandoId = null;

// DOM refs
const refs = {
  inputZona: document.getElementById('inputZona'),
  sugerenciasZona: document.getElementById('sugerenciasZona'),
  inputCliente: document.getElementById('inputCliente'),
  sugerenciasCliente: document.getElementById('sugerenciasCliente'),
  resultado: document.getElementById('resultado'),
  inputFecha: document.getElementById('fechaActual'),
  gba1: document.getElementById('gba1'),
  gba2: document.getElementById('gba2'),
  lejanas: document.getElementById('lejanas'),
  caba: document.getElementById('caba'),
  guardarBtn: document.getElementById('guardarBtn'),
  resetBtn: document.getElementById('resetBtn'),
  listaHistorial: document.getElementById('lista-historial'),
  pdfInput: document.getElementById('pdfInput'),
  analizarPdfBtn: document.getElementById('analizarPdfBtn'),
  pdfEstado: document.getElementById('pdfEstado'),
  pdfResultados: document.getElementById('pdfResultados')
};

function init() {
  refs.inputFecha.valueAsDate = new Date();
  attachListeners();
  renderizarHistorial();
  actualizarVistaContadores();
}

function attachListeners() {
  configurarBuscador(refs.inputZona, refs.sugerenciasZona, Object.keys(zonas), ciudad => {
    const zona = zonas[ciudad];
    contadores[zona] = (contadores[zona] || 0) + 1;
    actualizarVistaContadores();
    refs.resultado.textContent = `Agregado a ${zona}`;
    refs.inputZona.value = '';
    refs.inputZona.focus();
  });

  configurarBuscador(refs.inputCliente, refs.sugerenciasCliente, clientesFrecuentes, cliente => {
    refs.inputCliente.value = cliente;
    refs.inputZona.focus();
  });

  refs.gba1.addEventListener('change', sincronizarContadores);
  refs.gba2.addEventListener('change', sincronizarContadores);
  refs.lejanas.addEventListener('change', sincronizarContadores);
  refs.caba.addEventListener('change', sincronizarContadores);

  refs.resetBtn.addEventListener('click', () => {
    if (confirm('¿Limpiar panel actual?')) {
      contadores = { 'GBA 1': 0, 'GBA 2': 0, 'Zonas Lejanas': 0, 'CABA': 0 };
      refs.inputCliente.value = '';
      registroEditandoId = null;
      actualizarVistaContadores();
      refs.resultado.textContent = 'Esperando datos...';
      refs.inputFecha.valueAsDate = new Date();
    }
  });

  refs.guardarBtn.addEventListener('click', guardarRegistro);

  // PDF import flow
  refs.analizarPdfBtn.addEventListener('click', async () => {
    const file = refs.pdfInput.files && refs.pdfInput.files[0];
    if (!file) {
      refs.pdfEstado.textContent = 'Esperando archivo...';
      return;
    }

    refs.pdfEstado.textContent = 'Analizando...';
    try {
      const result = await analyzePDF(file);
      refs.pdfEstado.textContent = 'Análisis completado correctamente';
      mostrarResultadosPDF(result);

      // Integrar resultados sumando a contadores
      contadores['GBA 1'] += result.byZone['GBA 1'] || 0;
      contadores['GBA 2'] += result.byZone['GBA 2'] || 0;
      contadores['Zonas Lejanas'] += result.byZone['Zonas Lejanas'] || 0;
      contadores['CABA'] += result.byZone['CABA'] || 0;
      actualizarVistaContadores();
    } catch (err) {
      console.error(err);
      refs.pdfEstado.textContent = 'Error al procesar archivo';
      refs.pdfResultados.innerHTML = '<div class="line">Error: ' + (err.message || 'desconocido') + '</div>';
    }
  });

  // Close suggestion lists on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) {
      refs.sugerenciasZona.innerHTML = '';
      refs.sugerenciasCliente.innerHTML = '';
    }
  });
}

function mostrarResultadosPDF(result) {
  refs.pdfResultados.innerHTML = '';
  refs.pdfResultados.insertAdjacentHTML('beforeend', `<div class="line"><strong>Total:</strong> ${result.total} envíos</div>`);
  for (const zone of ['GBA 1', 'GBA 2', 'CABA', 'Zonas Lejanas']) {
    refs.pdfResultados.insertAdjacentHTML('beforeend', `<div class="line">${zone}: ${result.byZone[zone] || 0}</div>`);
  }
}

function configurarBuscador(inputEl, listaEl, data, onSelect) {
  let currentFocus = -1;

  inputEl.addEventListener('input', () => {
    const valor = normalizar(inputEl.value);
    listaEl.innerHTML = '';
    currentFocus = -1;
    if (!valor) return;

    const filtrados = Array.isArray(data) ? data : data;
    const matches = filtrados.filter(item => normalizar(item).includes(valor)).slice(0, 6);

    for (const item of matches) {
      const li = document.createElement('li');
      li.textContent = item.toUpperCase();
      li.addEventListener('click', () => {
        onSelect(item);
        listaEl.innerHTML = '';
      });
      listaEl.appendChild(li);
    }
  });

  inputEl.addEventListener('keydown', (e) => {
    const items = listaEl.getElementsByTagName('li');
    if (e.key === 'ArrowDown') { currentFocus++; highlight(items, currentFocus); }
    if (e.key === 'ArrowUp') { currentFocus--; highlight(items, currentFocus); }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (currentFocus > -1 && items[currentFocus]) items[currentFocus].click();
      else if (items.length > 0) items[0].click();
    }
  });

  function highlight(items, idx) {
    if (!items.length) return;
    for (let i = 0; i < items.length; i++) items[i].classList.remove('active');
    if (idx >= items.length) idx = 0;
    if (idx < 0) idx = items.length - 1;
    currentFocus = idx;
    items[currentFocus].classList.add('active');
  }
}

function actualizarVistaContadores() {
  refs.gba1.value = contadores['GBA 1'];
  refs.gba2.value = contadores['GBA 2'];
  refs.lejanas.value = contadores['Zonas Lejanas'];
  refs.caba.value = contadores['CABA'];
}

function sincronizarContadores() {
  contadores['GBA 1'] = parseInt(refs.gba1.value) || 0;
  contadores['GBA 2'] = parseInt(refs.gba2.value) || 0;
  contadores['Zonas Lejanas'] = parseInt(refs.lejanas.value) || 0;
  contadores['CABA'] = parseInt(refs.caba.value) || 0;
}

function guardarRegistro() {
  const fecha = refs.inputFecha.value;
  const cliente = refs.inputCliente.value.trim() || 'Desconocido';
  if (!fecha) return alert('Elegí una fecha.');
  sincronizarContadores();

  const historial = getHistorial();
  const nuevo = { id: registroEditandoId || Date.now(), fecha, cliente, datos: { ...contadores } };
  if (registroEditandoId) {
    const idx = historial.findIndex(h => h.id === registroEditandoId);
    if (idx !== -1) historial[idx] = nuevo;
  } else {
    historial.push(nuevo);
  }
  saveHistorial(historial);
  refs.resultado.textContent = '¡Registro guardado!';
  registroEditandoId = null;
  renderizarHistorial();
}

function renderizarHistorial() {
  const historial = getHistorial().slice().sort((a, b) => b.id - a.id);
  refs.listaHistorial.innerHTML = '';
  if (!historial.length) {
    refs.listaHistorial.innerHTML = '<div class="empty-state">No hay registros guardados.</div>';
    return;
  }

  for (const reg of historial) {
    const d = reg.datos;
    const total = (d['GBA 1']||0) + (d['GBA 2']||0) + (d['Zonas Lejanas']||0) + (d['CABA']||0);
    const fechaFmt = reg.fecha.split('-').reverse().join('/');

    const div = document.createElement('div');
    div.className = 'registro-dia';
    div.innerHTML = `
      <div class="registro-header">
        <span class="registro-fecha">📅 ${fechaFmt}</span>
        <span class="registro-total">Total: ${total}</span>
      </div>
      <span class="registro-cliente">👤 ${reg.cliente}</span>
      <div class="registro-datos">
        <span>GBA 1: <b>${d['GBA 1']}</b></span>
        <span>GBA 2: <b>${d['GBA 2']}</b></span>
        <span>Lejanas: <b>${d['Zonas Lejanas']}</b></span>
        <span>CABA: <b>${d['CABA']}</b></span>
      </div>
      <div class="registro-acciones">
        <button class="btn-accion btn-editar" data-id="${reg.id}">✏️ Editar</button>
        <button class="btn-accion btn-eliminar" data-id="${reg.id}">❌ Borrar</button>
      </div>
    `;

    refs.listaHistorial.appendChild(div);
  }

  // Attach handlers for edit/delete
  refs.listaHistorial.querySelectorAll('.btn-editar').forEach(btn => btn.addEventListener('click', (e) => {
    const id = Number(e.currentTarget.dataset.id);
    editarRegistro(id);
  }));
  refs.listaHistorial.querySelectorAll('.btn-eliminar').forEach(btn => btn.addEventListener('click', (e) => {
    const id = Number(e.currentTarget.dataset.id);
    if (confirm('¿Borrar este registro permanentemente?')) {
      const hist = getHistorial().filter(r => r.id !== id);
      saveHistorial(hist);
      renderizarHistorial();
    }
  }));
}

function editarRegistro(id) {
  const historial = getHistorial();
  const reg = historial.find(r => r.id === id);
  if (!reg) return;
  registroEditandoId = reg.id;
  contadores = { ...reg.datos };
  refs.inputCliente.value = reg.cliente === 'Desconocido' ? '' : reg.cliente;
  refs.inputFecha.value = reg.fecha;
  actualizarVistaContadores();
  refs.resultado.textContent = 'Editando registro...';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Initialize app
init();
