import { readFile, writeFile } from 'node:fs/promises';
import { CONFIG } from '../inspections/config.mjs';
import { validateConfig } from '../inspections/domain.mjs';

// The browser configuration remains the sole editable source of the 83 items.
validateConfig(CONFIG);
const path = new URL('../api/inspections/config.json', import.meta.url);
const generated = `${JSON.stringify(CONFIG, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if ((await readFile(path, 'utf8')).replaceAll('\r\n', '\n') !== generated) throw new Error('La configuración PHP no coincide con el catálogo JavaScript. Volvé a generarla antes de publicar.');
  console.log(`Verified PHP configuration ${CONFIG.version}: 8 categories, 83 items.`);
} else {
  await writeFile(path, generated);
  console.log(`Generated PHP configuration ${CONFIG.version}: 8 categories, 83 items.`);
}
