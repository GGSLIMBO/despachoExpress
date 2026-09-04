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

// Procesa ubicaciones del PDF (tanto de texto como de OCR)
function processLocations(lines) {
  console.log('🔍 processLocations recibió', lines.length, 'líneas');
  console.log('📝 Contenido de líneas:', lines);
  
  const extractedLocations = [];
  const cpRecords = [];

  // Identificamos las posiciones de los Códigos Postales de forma flexible
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    
    if (/^cp\b/i.test(line)) {
      console.log(`✓ Encontrado CP en línea ${idx}: "${line}"`);
      
      // Caso A: El CP y los dígitos están juntos en la misma línea (ej: "CP: 1424")
      const matchSameLine = line.match(/^cp\s*[:\-]?\s*(\d+)/i);
      
      if (matchSameLine) {
        console.log(`  → CP con número en misma línea: ${matchSameLine[1]}`);
        cpRecords.push({ cpLineIdx: idx, cpNumLineIdx: idx, cpNumber: matchSameLine[1] });
      } else {
        // Caso B: El texto es solo "CP:" y el número está en las líneas siguientes
        for (let j = idx + 1; j < Math.min(idx + 5, lines.length); j++) {
          if (/^\d+$/.test(lines[j])) {
            console.log(`  → CP con número en línea ${j}: ${lines[j]}`);
            cpRecords.push({ cpLineIdx: idx, cpNumLineIdx: j, cpNumber: lines[j] });
            break;
          }
        }
      }
    }
  }

  console.log('🎯 Total CP encontrados:', cpRecords.length);

  if (cpRecords.length === 0) {
    console.log('❌ No se encontraron códigos postales');
    return extractedLocations;
  }

  // DETECCIÓN DE ESTRUCTURA (Horizontal vs Vertical)
  // Si la distancia entre el primer "CP:" y el último "CP:" de la página es corta
  // (menos de 15 líneas), significa que están agrupados horizontalmente uno tras otro.
  const isHorizontal = cpRecords.length > 1 && (cpRecords[cpRecords.length - 1].cpLineIdx - cpRecords[0].cpLineIdx < 15);
  console.log('📐 Estructura:', isHorizontal ? 'HORIZONTAL' : 'VERTICAL');

  for (let k = 0; k < cpRecords.length; k++) {
    let loc = 'Unknown';
    
    if (isHorizontal) {
      // MODO HORIZONTAL: Las localidades empiezan inmediatamente después del último número de CP.
      const lastCpNumIdx = cpRecords[cpRecords.length - 1].cpNumLineIdx;
      const locIndex = lastCpNumIdx + 1 + k;
      if (lines[locIndex]) {
        loc = lines[locIndex];
        console.log(`  CP[${k}] → Localidad (horizontal): "${loc}"`);
      }
    } else {
      // MODO VERTICAL: La localidad es la primera línea válida debajo del número de CP
      const startIdx = cpRecords[k].cpNumLineIdx + 1;
      for (let j = startIdx; j < lines.length; j++) {
        const candidate = lines[j];
        // Frenamos si cruzamos a campos clave de la misma etiqueta o al siguiente CP
        if (/^(direccion|barrio|ref|destinatario|cp\b)/i.test(candidate)) {
          break;
        }
        if (candidate) {
          loc = candidate;
          console.log(`  CP[${k}] (${cpRecords[k].cpNumber}) → Localidad: "${loc}"`);
          break;
        }
      }
    }
    extractedLocations.push(loc);
  }

  console.log('📦 Localidades extraídas:', extractedLocations);
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
      const viewport = page.getViewport({ scale: 2 }); // 2x para mejor OCR
      
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: context, viewport }).promise;

      // Aplicar OCR a la imagen
      const imageData = canvas.toDataURL('image/png');
      const worker = await Tesseract.createWorker();
      await worker.loadLanguage('spa'); // Español
      await worker.initialize('spa');
      
      console.log(`🔄 OCR ejecutando en página ${i}...`);
      const result = await worker.recognize(imageData);
      const ocrText = result.data.text;
      
      await worker.terminate();

      console.log(`✅ OCR completado en página ${i}. Texto encontrado: ${ocrText.length} caracteres`);

      // Procesar texto OCR: mantener líneas pero usar la lógica de CP
      const pageLines = ocrText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && line.length > 0); // Solo eliminar vacías
      
      console.log(`📋 OCR página ${i}: ${pageLines.length} líneas`);
      console.log('Primeras líneas OCR:', pageLines.slice(0, 15));
      
      allLines.push(...pageLines);
    } catch (err) {
      console.error(`❌ Error en OCR de página ${i}:`, err);
    }
  }

  console.log(`📊 Total líneas de OCR: ${allLines.length}`);
  
  // Procesar con la misma lógica de CP que el método de texto extraído
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
      // PDF con texto extraíble: usar método original
      console.log('✅ Usando extracción de texto directo');
      const lines = await extractTextFromPDF(pdf);
      extractedLocations = processLocations(lines);
    } else {
      // PDF escaneado: aplicar OCR
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
