const STORAGE_KEY = 'historialV4';

export function getHistorial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Error reading historial', err);
    return [];
  }
}

export function saveHistorial(historial) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(historial));
  } catch (err) {
    console.error('Error saving historial', err);
  }
}
