import { zonas } from '../data/zonas.js';
import { normalizar } from '../utils/helpers.js';

// Clasifica un string de ubicación normalizado contra el mapa de zonas
export function classifyLocation(location) {
  if (!location) return 'Unknown';
  const locNorm = normalizar(location);

  // Coincidencia exacta primero
  for (const key of Object.keys(zonas)) {
    if (normalizar(key) === locNorm) return zonas[key];
  }

  // Coincidencia relajada: prefiere la clave más larga que coincida
  const candidates = Object.keys(zonas).filter(k => {
    const kn = normalizar(k);
    return kn.includes(locNorm) || locNorm.includes(kn) || kn.startsWith(locNorm) || locNorm.startsWith(kn);
  });
  if (candidates.length) {
    candidates.sort((a, b) => b.length - a.length);
    return zonas[candidates[0]];
  }

  return 'Unknown';
}

// Intenta extraer texto del PDF
async function extractTextFromPDF(pdf) {
  const lines = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageLines = content.items.map(it => it.str.trim()).filter(Boolean);
    lines.push(...pageLines);
  }

  return lines;
}

// Detecta si el PDF tiene texto extraíble significativo
async function hasMeaningfulText(pdf) {
  try {
    const lines = await extractTextFromPDF(pdf);
    console.log('📄 Total líneas extraídas:', lines.length);
    console.log('📋 Primeras 10 líneas:', lines.slice(0, 10));
    
    // Si hay menos de 5 líneas con contenido real, es probablemente un escaneo
    const meaningfulLines = lines.filter(line => 
      line.length > 2 && !/^\d+$/.test(line)
    );
    console.log('✨ Líneas significativas:', meaningfulLines.length);
    return meaningfulLines.length >= 5;
  } catch (err) {
    console.error('Error en hasMeaningfulText:', err);
    return false;
  }
}

// Procesa ubicaciones buscando el patrón: número (CP) → localidad
function processLocations(lines) {
  console.log('🔍 processLocations recibió', lines.length, 'líneas');
  
  const extractedLocations = [];

  // Estrategia: buscar líneas que sean solo números (códigos postales)
  // La siguiente línea debería ser la localidad
  for (let idx = 0; idx < lines.length - 1; idx++) {
    const line = lines[idx];
    const nextLine = lines[idx + 1];
    
    // Si esta línea es solo números y la siguiente tiene letras y no es metadato
    if (/^\d+$/.test(line) && nextLine && nextLine.length > 0) {
      // Validar que la siguiente línea es una localidad válida
      // (contiene letras, no es un número, no es metadato)
      if (!/^\d+$/.test(nextLine) && 
          !/^(flex|pack|envio|referencia|direccion|barrio|destinatario|resid|comercial)/i.test(nextLine)) {
        
        console.log(`✓ CP[${line}] → Localidad: "${nextLine}"`);
        extractedLocations.push(nextLine);
      }
    }
  }

  console.log('📦 Localidades extraídas:', extractedLocations);
  console.log('📊 Total encontrado:', extractedLocations.length);
  return extractedLocations;
}

// Aplica OCR usando Tesseract.js
async function performOCR(pdf) {
  if (typeof Tesseract === 'undefined') {
    throw new Error('Tesseract.js no está disponible. Se requiere para procesar PDFs escaneados.');
  }

  const allLines = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      console.log(`🖼️ OCR: Procesando página ${i}...`);
      
      // Renderizar página como imagen
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: context, viewport }).promise;

      // Aplicar OCR a la imagen
      const imageData = canvas.toDataURL('image/png');
      const worker = await Tesseract.createWorker();
      await worker.loadLanguage('spa');
      await worker.initialize('spa');
      
      console.log(`🔄 OCR ejecutando en página ${i}...`);
      const result = await worker.recognize(imageData);
      const ocrText = result.data.text;
      
      await worker.terminate();

      console.log(`✅ OCR completado en página ${i}. Texto: ${ocrText.length} caracteres`);

      // Procesar texto OCR
      const pageLines = ocrText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && line.length > 0);
      
      console.log(`📋 OCR página ${i}: ${pageLines.length} líneas`);
      console.log('Líneas:', pageLines);
      
      allLines.push(...pageLines);
    } catch (err) {
      console.error(`❌ Error en OCR de página ${i}:`, err);
    }
  }

  console.log(`📊 Total líneas de OCR: ${allLines.length}`);
  return processLocations(allLines);
}

export async function analyzePDF(file) {
  console.log('🚀 analyzePDF iniciado con archivo:', file.name);
  
  if (!file || file.type !== 'application/pdf') throw new Error('Archivo inválido, se requiere un PDF.');

  const arrayBuffer = await file.arrayBuffer();

  try {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    console.log(`📄 PDF cargado: ${pdf.numPages} páginas`);

    let extractedLocations = [];
    let usedOCR = false;

    // Intentar extraer texto directamente
    const hasText = await hasMeaningfulText(pdf);
    console.log('📖 ¿Tiene texto extraíble?', hasText);

    if (hasText) {
      console.log('✅ Usando extracción de texto directo');
      const lines = await extractTextFromPDF(pdf);
      extractedLocations = processLocations(lines);
    } else {
      console.log('🔄 PDF escaneado detectado, aplicando OCR...');
      extractedLocations = await performOCR(pdf);
      usedOCR = true;
    }

    console.log('📍 Total localidades extraídas:', extractedLocations.length);

    // Calculamos los totales finales y armamos el reporte por zonas
    const byZone = { 'GBA 1': 0, 'GBA 2': 0, 'Zonas Lejanas': 0, 'CABA': 0, 'Unknown': 0 };
    const raw = [];

    for (const loc of extractedLocations) {
      const zone = classifyLocation(loc);
      raw.push({ location: loc, zone });
      
      if (byZone.hasOwnProperty(zone)) {
        byZone[zone] += 1;
      } else {
        byZone.Unknown += 1;
      }
    }

    console.log('✅ Resultado final:', { total: extractedLocations.length, byZone, usedOCR });

    return { 
      total: extractedLocations.length, 
      byZone, 
      raw,
      usedOCR
    };
  } catch (err) {
    console.error('❌ Error analyzing PDF', err);
    throw err;
  }
}
