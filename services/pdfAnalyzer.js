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
    // Si hay menos de 5 líneas o la mayoría son números, probablemente es un escaneo
    const meaningfulLines = lines.filter(line => !/^\d+$/.test(line));
    return meaningfulLines.length >= 5;
  } catch {
    return false;
  }
}

// Aplica OCR usando Tesseract.js
async function performOCR(pdf) {
  if (typeof Tesseract === 'undefined') {
    throw new Error('Tesseract.js no está disponible. Se requiere para procesar PDFs escaneados.');
  }

  const extractedLocations = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    try {
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
      
      const result = await worker.recognize(imageData);
      const ocrText = result.data.text;
      
      await worker.terminate();

      // Procesar texto OCR de forma similar al texto extraído
      const lines = ocrText
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
      
      extractedLocations.push(...lines);
    } catch (err) {
      console.warn(`Error en OCR de página ${i}:`, err);
    }
  }

  return extractedLocations;
}

// Procesa ubicaciones del PDF (tanto de texto como de OCR)
function processLocations(lines) {
  const extractedLocations = [];
  const cpRecords = [];

  // Identificamos las posiciones de los Códigos Postales de forma flexible
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    
    if (/^cp\b/i.test(line)) {
      // Caso A: El CP y los dígitos están juntos en la misma línea
      const matchSameLine = line.match(/^cp\s*[:\-]?\s*(\d+)/i);
      
      if (matchSameLine) {
        cpRecords.push({ cpLineIdx: idx, cpNumLineIdx: idx, cpNumber: matchSameLine[1] });
      } else {
        // Caso B: El texto es solo "CP:" y el número está en las líneas siguientes
        for (let j = idx + 1; j < Math.min(idx + 5, lines.length); j++) {
          if (/^\d+$/.test(lines[j])) {
            cpRecords.push({ cpLineIdx: idx, cpNumLineIdx: j, cpNumber: lines[j] });
            break;
          }
        }
      }
    }
  }

  if (cpRecords.length === 0) return extractedLocations;

  // DETECCIÓN DE ESTRUCTURA (Horizontal vs Vertical)
  const isHorizontal = cpRecords.length > 1 && (cpRecords[cpRecords.length - 1].cpLineIdx - cpRecords[0].cpLineIdx < 15);

  for (let k = 0; k < cpRecords.length; k++) {
    let loc = 'Unknown';
    
    if (isHorizontal) {
      // MODO HORIZONTAL: Las localidades empiezan inmediatamente después del último número de CP
      const lastCpNumIdx = cpRecords[cpRecords.length - 1].cpNumLineIdx;
      const locIndex = lastCpNumIdx + 1 + k;
      if (lines[locIndex]) {
        loc = lines[locIndex];
      }
    } else {
      // MODO VERTICAL: La localidad es la primera línea válida debajo del número de CP
      const startIdx = cpRecords[k].cpNumLineIdx + 1;
      for (let j = startIdx; j < lines.length; j++) {
        const candidate = lines[j];
        // Frenamos si cruzamos a campos clave o al siguiente CP
        if (/^(direccion|barrio|ref|destinatario|cp\b)/i.test(candidate)) {
          break;
        }
        if (candidate) {
          loc = candidate;
          break;
        }
      }
    }
    extractedLocations.push(loc);
  }

  return extractedLocations;
}

export async function analyzePDF(file) {
  if (!file || file.type !== 'application/pdf') throw new Error('Archivo inválido, se requiere un PDF.');

  const arrayBuffer = await file.arrayBuffer();

  try {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    let extractedLocations = [];
    let usedOCR = false;

    // Intentar extraer texto directamente
    const hasText = await hasMeaningfulText(pdf);

    if (hasText) {
      // PDF con texto extraíble: usar método original
      const lines = await extractTextFromPDF(pdf);
      extractedLocations = processLocations(lines);
    } else {
      // PDF escaneado: aplicar OCR
      console.log('Detectado PDF escaneado, aplicando OCR...');
      extractedLocations = await performOCR(pdf);
      usedOCR = true;
    }

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

    return { 
      total: extractedLocations.length, 
      byZone, 
      raw,
      usedOCR // Indicar si se usó OCR para feedback al usuario
    };
  } catch (err) {
    console.error('Error analyzing PDF', err);
    throw err;
  }
}
