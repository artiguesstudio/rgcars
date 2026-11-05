// Criterio interno propuesto, sujeto a validación de RG Cars.
// Para cambiar criterios: crear otra versión, ejecutar el seed y desplegar.
// Los informes aprobados conservan su propia copia de esta configuración.
const groups = [
  ['exterior', 'CARROCERÍA EXTERIOR', 17.5, [
    ['chapa-patente', 'Chapa patente', 1],
    ['paragolpe-delantero', 'Paragolpe delantero', 10],
    ['antiniebla-delantero', 'Antiniebla delantero', 1],
    ['parrilla', 'Parrilla', 3],
    ['optica-delantera', 'Óptica delantera', 7],
    ['insignias-delanteras', 'Insignias delanteras', 1],
    ['capot', 'Capot', 5],
    ['parabrisas', 'Estado de parabrisas (fisuras / impactos)', 10, 'windshield'],
    ['escobilla', 'Escobilla', 1],
    ['bagueta', 'Bagueta', 1],
    ['guardabarro-delantero-conductor', 'Guardabarro delantero conductor', 2],
    ['puerta-delantera-conductor', 'Puerta delantera conductor', 2],
    ['espejo-conductor', 'Espejo conductor', 2],
    ['puerta-trasera-conductor', 'Puerta trasera conductor', 2],
    ['guardabarro-trasero-conductor', 'Guardabarro trasero conductor', 2],
    ['baul-caja', 'Baúl / caja', 10],
    ['paragolpe-trasero', 'Paragolpe trasero', 10],
    ['insignias-traseras', 'Insignias traseras', 1],
    ['optica-trasera', 'Óptica trasera', 5],
    ['luneta', 'Luneta', 1],
    ['guardabarro-trasero-acompanante', 'Guardabarro trasero acompañante', 2],
    ['puerta-trasera-acompanante', 'Puerta trasera acompañante', 2],
    ['puerta-delantera-acompanante', 'Puerta delantera acompañante', 2],
    ['espejo-acompanante', 'Espejo acompañante', 1],
    ['guardabarro-delantero-acompanante', 'Guardabarro delantero acompañante', 5],
    ['techo', 'Techo', 10],
    ['antena', 'Antena', 1],
    ['pintura', 'Pintura general (% original / repintado)', 10, 'percentage', '% original', 'original_paint'],
    ['golpes', 'Presencia de golpes (detallar zona)', 10, 'damage'],
  ]],
  ['interior-estetica', 'CARROCERÍA INTERIOR ESTÉTICA', 12.5, [
    ['entrada-puerta', 'Entrada de puerta', 15], ['burlete', 'Burlete', 8],
    ['asientos', 'Asientos', 20], ['panel-puerta', 'Panel de puerta', 2],
    ['techo-interior', 'Techo (interior)', 16], ['volante', 'Volante', 15],
    ['guantera', 'Guantera', 2], ['tablero', 'Tablero', 2],
    ['freno-mano', 'Freno de mano', 8], ['palanca-cambios', 'Palanca de cambios', 2],
    ['alfombra', 'Alfombra', 10],
  ]],
  ['luces', 'LUCES', 4, [
    ['luz-baja', 'Luz baja', 20], ['luz-alta', 'Luz alta', 20],
    ['posicion', 'Luces de posición', 20], ['giro', 'Luces de giro', 20],
    ['freno', 'Luces de freno', 20],
  ]],
  ['interior-funcion', 'CARROCERÍA INTERIOR FUNCIÓN', 12.5, [
    ['levanta-cristal', 'Levanta cristal', 4], ['cierre-puertas', 'Cierre de puertas', 4],
    ['espejo-electronico', 'Espejo electrónico', 2], ['techo-electrico', 'Techo eléctrico', 10],
    ['radio', 'Radio', 15], ['aire-acondicionado', 'Aire acondicionado', 20],
    ['calefaccion', 'Calefacción', 20], ['comando-volante', 'Comando de volante', 5],
    ['llave', 'Llave', 10], ['asiento-electronico', 'Asiento electrónico', 5],
    ['cerradura', 'Cerradura', 5],
  ]],
  ['chasis', 'CHASIS', 16.5, [
    ['tasas', 'Tasas', 1], ['tren-delantero', 'Tren delantero', 20],
    ['tren-trasero', 'Tren trasero', 5],
    ['caja-cambios', 'Caja de cambios (% de suavidad)', 5, 'percentage', '% de suavidad estimada'],
    ['diferencial', 'Diferencial', 5],
    ['amortiguadores', 'Amortiguadores (% eficiencia estimada)', 15, 'percentage', '% eficiencia estimada'],
    ['direccion', 'Dirección / cremallera', 5], ['embrague', 'Embrague', 10],
    ['escape', 'Escape', 2],
    ['frenos-delantero', 'Frenos delantero (% vida útil)', 5, 'percentage', '% vida útil estimada', undefined, 'percentage'],
    ['frenos-trasero', 'Frenos trasero (% vida útil)', 5, 'percentage', '% vida útil estimada', undefined, 'percentage'],
    ['discos-pastillas', 'Estado de disco y pastillas', 5],
  ]],
  ['neumaticos', 'NEUMÁTICOS Y LLANTAS', 16.5, [
    ['delantera-izquierda', 'Rueda delantera izquierda', 4, 'tire'],
    ['delantera-derecha', 'Rueda delantera derecha', 4, 'tire'],
    ['trasera-izquierda', 'Rueda trasera izquierda', 4, 'tire'],
    ['trasera-derecha', 'Rueda trasera derecha', 4, 'tire'],
    ['auxilio', 'Rueda de auxilio', 4, 'tire'],
    ['llantas', 'Estado de llantas (golpes / rayones / fisuras)', 2, 'damage'],
  ]],
  ['motor', 'MOTOR / MARCA', 16.5, [
    ['bateria', 'Batería', 3], ['alternador', 'Alternador', 3],
    ['burro-arranque', 'Burro de arranque', 20], ['inyectores', 'Inyectores', 20],
    ['motor', 'Motor', 30], ['turbo', 'Turbo', 24],
  ]],
  ['varios', 'VARIOS', 4, [
    ['gato', 'Gato', 30], ['llave-cruz', 'Llave cruz', 10], ['matafuego', 'Matafuego', 10],
  ]],
];

export function deepFreeze(value) {
  Object.values(value).forEach(child => { if (child && typeof child === 'object') deepFreeze(child); });
  return Object.freeze(value);
}

export const CONFIG = deepFreeze({
  version: 'rgcars-83-v2',
  scale_version: 'propuesta-interna-v2',
  scale_notice: 'Criterio interno propuesto, sujeto a validación del cliente: Bueno = 1; Regular = 0,5; Malo = 0. En frenos se utiliza el porcentaje de vida útil / 100. No determina aptitud ni riesgo.',
  factors: { B: 1, R: 0.5, M: 0 },
  allow_na: true,
  categories: groups.map(([id, label, max, items], order) => ({
    id, label, max, order: order + 1,
    items: items.map(([slug, itemLabel, weight, type = 'state', unit, partition, scoring], index) => ({
      id: `${id}-${slug}`, label: itemLabel, weight, type, order: index + 1,
      ...(unit ? { unit } : {}), ...(partition ? { partition } : {}),
      ...(scoring ? { scoring } : {}),
      ...(type === 'tire' ? { details_required: false } : {}),
    })),
  })),
});
