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

export async function analyzePDF(file) {
  if (!file || file.type !== 'application/pdf') throw new Error('Archivo inválido, se requiere un PDF.');

  const arrayBuffer = await file.arrayBuffer();

  try {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    const extractedLocations = [];

    // Procesamos página por página para mantener el orden de las etiquetas
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      
      // Filtramos líneas vacías y limpiamos espacios
      const lines = content.items.map(it => it.str.trim()).filter(Boolean);
      
      const cpRecords = [];
      
      // Identificamos las posiciones de los Códigos Postales de forma flexible
      for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];
        
        if (/^cp\b/i.test(line)) {
          // Caso A: El CP y los dígitos están juntos en la misma línea (ej: "CP: 1424")
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

      if (cpRecords.length === 0) continue;

      // DETECCIÓN DE ESTRUCTURA (Horizontal vs Vertical)
      // Si la distancia entre el primer "CP:" y el último "CP:" de la página es corta
      // (menos de 15 líneas), significa que están agrupados horizontalmente uno tras otro.
      const isHorizontal = cpRecords.length > 1 && (cpRecords[cpRecords.length - 1].cpLineIdx - cpRecords[0].cpLineIdx < 15);

      for (let k = 0; k < cpRecords.length; k++) {
        let loc = 'Unknown';
        
        if (isHorizontal) {
          // MODO HORIZONTAL: Las localidades empiezan inmediatamente después del último número de CP.
          // Sumamos el índice del último número de CP + 1 + la posición de la etiqueta actual (k)
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
            // Frenamos si cruzamos a campos clave de la misma etiqueta o al siguiente CP
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

    return { total: extractedLocations.length, byZone, raw };
  } catch (err) {
    console.error('Error analyzing PDF', err);
    throw err;
  }
}
