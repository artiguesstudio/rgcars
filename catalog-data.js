(function () {
  const cities = ['Río Grande', 'Tolhuin', 'Ushuaia'];

  const brands = {
    auto: {
      Abarth: ['500', '595', '695'],
      'Alfa Romeo': ['Giulietta', 'Mito'],
      Audi: ['A1', 'A3', 'A4', 'A5', 'A6', 'TT'],
      BMW: ['Serie 1', 'Serie 2', 'Serie 3', 'Serie 4', 'Serie 5'],
      Chevrolet: ['Agile', 'Astra', 'Aveo', 'Classic', 'Corsa', 'Cruze', 'Joy', 'Meriva', 'Onix', 'Prisma', 'Sonic', 'Spin'],
      Chery: ['Arrizo 5', 'Fulwin', 'QQ'],
      Citroën: ['C3', 'C4', 'C4 Lounge', 'C-Elysée', 'Xsara Picasso'],
      DS: ['DS 3', 'DS 4'],
      Fiat: ['500', 'Argo', 'Cronos', 'Grand Siena', 'Mobi', 'Palio', 'Pulse', 'Siena', 'Tipo', 'Uno'],
      Ford: ['Fiesta', 'Focus', 'Ka', 'Mondeo', 'Mustang'],
      Geely: ['CK', 'Emgrand 7'],
      Honda: ['Accord', 'City', 'Civic', 'Fit'],
      Hyundai: ['Accent', 'Elantra', 'Genesis', 'HB20'],
      Kia: ['Cerato', 'Morning', 'Picanto', 'Rio'],
      Lifan: ['320', '620'],
      'Mercedes-Benz': ['Clase A', 'Clase B', 'Clase C', 'CLA'],
      MINI: ['Cooper', 'Clubman'],
      Nissan: ['March', 'Sentra', 'Tiida', 'Versa'],
      Peugeot: ['206', '207', '208', '301', '307', '308', '408', '508'],
      Renault: ['Clio', 'Fluence', 'Kwid', 'Logan', 'Mégane', 'Sandero', 'Symbol'],
      Seat: ['Ibiza', 'León'],
      Subaru: ['Impreza', 'Legacy'],
      Suzuki: ['Baleno', 'Dzire', 'Swift'],
      Toyota: ['Corolla', 'Etios', 'Prius', 'Yaris'],
      Volkswagen: ['Bora', 'Fox', 'Gol', 'Polo', 'Suran', 'Up!', 'Vento', 'Virtus', 'Voyage'],
      Volvo: ['S60', 'S90', 'V40'],
    },
    camioneta: {
      Chevrolet: ['Montana', 'S10', 'Silverado'],
      Fiat: ['Strada', 'Toro'],
      Ford: ['F-100', 'F-150', 'F-250', 'F-4000', 'Maverick', 'Ranger'],
      'Great Wall': ['Poer', 'Wingle'],
      Jeep: ['Gladiator'],
      Mitsubishi: ['L200'],
      Nissan: ['Frontier', 'NP300'],
      RAM: ['700', '1500', '2500', 'Rampage'],
      Renault: ['Alaskan', 'Duster Oroch'],
      Toyota: ['Hilux'],
      Volkswagen: ['Amarok', 'Saveiro'],
    },
    suv: {
      Audi: ['Q2', 'Q3', 'Q5', 'Q7'],
      BMW: ['X1', 'X3', 'X5'],
      Chevrolet: ['Captiva', 'Equinox', 'Tracker', 'Trailblazer'],
      Chery: ['Tiggo 2', 'Tiggo 3', 'Tiggo 4', 'Tiggo 5', 'Tiggo 7', 'Tiggo 8'],
      Citroën: ['Aircross', 'C3 Aircross', 'C4 Cactus', 'C5 Aircross'],
      DFSK: ['Glory 580'],
      DS: ['DS 3 Crossback', 'DS 7'],
      Fiat: ['Fastback', 'Pulse'],
      Ford: ['Bronco Sport', 'EcoSport', 'Everest', 'Kuga', 'Territory'],
      Haval: ['H6', 'Jolion'],
      Honda: ['CR-V', 'HR-V', 'WR-V', 'ZR-V'],
      Hyundai: ['Creta', 'Kona', 'Santa Fe', 'Tucson', 'Venue'],
      Jeep: ['Commander', 'Compass', 'Renegade'],
      Kia: ['Seltos', 'Sorento', 'Sportage'],
      'Land Rover': ['Discovery Sport', 'Evoque', 'Freelander'],
      'Mercedes-Benz': ['GLA', 'GLB', 'GLC'],
      Nissan: ['Kicks', 'Murano', 'X-Trail'],
      Peugeot: ['2008', '3008', '5008'],
      Renault: ['Captur', 'Duster', 'Koleos'],
      Subaru: ['Forester', 'Outback', 'XV'],
      Toyota: ['Corolla Cross', 'RAV4', 'SW4'],
      Volkswagen: ['Nivus', 'Taos', 'T-Cross', 'Tiguan', 'Touareg'],
      Volvo: ['XC40', 'XC60', 'XC90'],
    },
    moto: {
      Benelli: ['TNT 15', 'TRK 502'],
      Corven: ['Energy', 'Hunter'],
      Honda: ['CB 125F', 'CG Titan', 'XR 150L', 'XR 250 Tornado'],
      Motomel: ['S2', 'Skua'],
      Suzuki: ['AX 100', 'GN 125'],
      Yamaha: ['FZ-S', 'MT-03', 'XTZ 125'],
      Zanella: ['RX 150', 'ZR 150'],
    },
    utilitario: {
      Chevrolet: ['Montana'],
      Citroën: ['Berlingo', 'Jumpy', 'Jumper'],
      Fiat: ['Doblo', 'Ducato', 'Fiorino', 'Scudo'],
      Ford: ['Transit'],
      Iveco: ['Daily'],
      'Mercedes-Benz': ['Sprinter', 'Vito'],
      Peugeot: ['Boxer', 'Expert', 'Partner'],
      Renault: ['Kangoo', 'Master', 'Trafic'],
      Toyota: ['Hiace'],
      Volkswagen: ['Caddy', 'Crafter', 'Transporter'],
    },
    camion: {
      Agrale: ['A8700'],
      Ford: ['Cargo', 'F-4000'],
      Iveco: ['Daily', 'Hi-Way', 'Tector'],
      'Mercedes-Benz': ['Accelo', 'Actros', 'Atego'],
      Scania: ['G Series', 'P Series', 'R Series'],
      Volkswagen: ['Constellation', 'Delivery'],
      Volvo: ['FH', 'FM', 'VM'],
    },
    otro: {},
  };

  const fuelOptions = ['Nafta', 'Diésel', 'Híbrido', 'Eléctrico', 'GNC', 'Otro'];
  const transmissionOptions = ['Manual', 'Automática'];
  const colorOptions = ['Blanco', 'Negro', 'Gris', 'Plata', 'Azul', 'Rojo', 'Verde', 'Bordó', 'Otro'];
  const useCaseOptions = ['Ciudad', 'Ruta', 'Trabajo', 'Familia', 'Viajes', 'Otro'];

  function allBrands() {
    const set = new Set();
    Object.values(brands).forEach((group) => Object.keys(group).forEach((brand) => set.add(brand)));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }

  function modelsFor(brand, category) {
    if (!brand) return [];
    const source = category && brands[category] ? brands[category] : null;
    if (source && source[brand]) return source[brand];
    for (const group of Object.values(brands)) {
      if (group[brand]) return group[brand];
    }
    return [];
  }

  function brandsFor(category) {
    if (category && brands[category]) return Object.keys(brands[category]).sort((a, b) => a.localeCompare(b, 'es'));
    return allBrands();
  }

  window.RGCatalog = {
    cities,
    brands,
    brandsFor,
    modelsFor,
    fuelOptions,
    transmissionOptions,
    colorOptions,
    useCaseOptions,
  };
})();
