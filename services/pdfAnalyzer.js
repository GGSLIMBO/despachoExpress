import { zonas } from '../data/zonas.js';
import { normalizar, escapeRegExp } from '../utils/helpers.js';

// Uses global pdfjsLib (loaded via CDN in index.html)

function countOccurrences(text, needle) {
  const re = new RegExp('\\b' + escapeRegExp(needle) + '\\b', 'gi');
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

export async function analyzePDF(file) {
  if (!file || file.type !== 'application/pdf') throw new Error('Archivo inválido, se requiere un PDF.');

  // Read file as array buffer
  const arrayBuffer = await file.arrayBuffer();

  try {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strs = content.items.map(it => it.str).join(' ');
      fullText += ' ' + strs;
    }

    const normalized = normalizar(fullText);

    // For each known localidad, count occurrences
    const byZone = { 'GBA 1': 0, 'GBA 2': 0, 'Zonas Lejanas': 0, 'CABA': 0 };
    const rawCounts = {};

    for (const localidad of Object.keys(zonas)) {
      const nloc = normalizar(localidad);
      const c = countOccurrences(normalized, nloc);
      if (c > 0) {
        rawCounts[localidad] = c;
        const zona = zonas[localidad];
        byZone[zona] = (byZone[zona] || 0) + c;
      }
    }

    const total = Object.values(byZone).reduce((s, v) => s + v, 0);

    return { total, byZone, raw: rawCounts };
  } catch (err) {
    console.error('Error analyzing PDF', err);
    throw err;
  }
}
