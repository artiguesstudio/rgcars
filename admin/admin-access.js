window.RGAdminAccess = {
  defaultProfile: {
    key: 'full_admin',
    label: 'Administrador',
    allowedViews: ['overview', 'vehicles', 'leads', 'insurance', 'financing', 'metrics', 'settings'],
    landingView: 'overview',
    canChangePassword: true,
    restricted: false,
  },
  users: {
    'ventas@rgcars.com.ar': {
      key: 'ventas',
      label: 'Ventas',
      allowedViews: ['vehicles', 'leads'],
      landingView: 'vehicles',
      canChangePassword: false,
      restricted: true,
      note: 'Acceso restringido a Vehículos y Leads.',
    },
  },
};
