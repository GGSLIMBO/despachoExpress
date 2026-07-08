import { zonas } from '../data/zonas.js';
import { normalizar } from '../utils/helpers.js';

// Uses global pdfjsLib (loaded via CDN in index.html)

// Extract individual labels from the full PDF text by locating CP markers.
export function extractLabels(text) {
  if (!text) return [];
  // Normalize line endings
  const norm = text.replace(/\r/g, '\n');
  const cpRegex = /cp\s*[:\-]?\s*\d{3,6}/gi;
  const matches = [];
  let m;
  while ((m = cpRegex.exec(norm)) !== null) {
    matches.push(m.index);
  }
  if (matches.length === 0) {
    // Fallback: try splitting by double newlines if no CP markers found
    return norm.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  }

  const labels = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1] : norm.length;
    const chunk = norm.slice(start, end).trim();
    labels.push(chunk);
  }
  return labels;
}

// From a single label block, extract the primary location: the first non-empty line after the CP line
export function getPrimaryLocation(labelText) {
  if (!labelText) return null;
  const lines = labelText.split(/\n+/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  // Find line containing 'CP'
  const cpIdx = lines.findIndex(l => /\bcp\b/i.test(l));

  if (cpIdx === -1) {
    // If no CP line, attempt to find a line that looks like a postal code alone and take the next
    const idx = lines.findIndex(l => /^\d{3,6}$/.test(l));
    if (idx !== -1 && idx + 1 < lines.length) return lines[idx + 1];
    return null;
  }

  const cpLine = lines[cpIdx];
  // Check if locality appears on same line after the CP
  const sameLineMatch = cpLine.match(/\bcp\b\s*[:\-]?\s*\d{3,6}\s*(.*)$/i);
  if (sameLineMatch && sameLineMatch[1] && sameLineMatch[1].trim()) {
    return sameLineMatch[1].trim();
  }

  // Otherwise take the next non-empty line after CP
  for (let j = cpIdx + 1; j < lines.length; j++) {
    const candidate = lines[j].trim();
    if (candidate && !/^direccion\b/i.test(candidate) && !/^ref(erencia)?\b/i.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

// Classify a normalized location string against the zonas map
export function classifyLocation(location) {
  if (!location) return 'Unknown';
  const locNorm = normalizar(location);

  // Exact match first
  for (const key of Object.keys(zonas)) {
    if (normalizar(key) === locNorm) return zonas[key];
  }

  // Try more relaxed matching: prefer longest matching key
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

export function calculateZones(labels) {
  const byZone = { 'GBA 1': 0, 'GBA 2': 0, 'Zonas Lejanas': 0, 'CABA': 0, 'Unknown': 0 };
  const raw = [];

  for (const label of labels) {
    const loc = getPrimaryLocation(label);
    const zone = classifyLocation(loc);
    raw.push({ location: loc, zone });
    if (byZone.hasOwnProperty(zone)) byZone[zone] += 1;
    else byZone.Unknown += 1;
  }

  const total = labels.length;
  return { total, byZone, raw };
}

export async function analyzePDF(file) {
  if (!file || file.type !== 'application/pdf') throw new Error('Archivo inválido, se requiere un PDF.');

  const arrayBuffer = await file.arrayBuffer();

  try {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // Preserve line breaks to allow label extraction
      const strs = content.items.map(it => it.str).join('\n');
      fullText += '\n' + strs + '\n';
    }

    const labels = extractLabels(fullText);
    const result = calculateZones(labels);

    // Ensure total equals number of labels (one envio per etiqueta)
    return result;
  } catch (err) {
    console.error('Error analyzing PDF', err);
    throw err;
  }
}
