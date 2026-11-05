<?php
// Copiar fuera de public_html como /home2/rgcarsco/rgcars-inspections-secrets.php.
// No guardar la copia completada en Git ni incluirla en un paquete público.
return [
    'RGC_INSPECTION_DB_HOST' => '10.0.10.74',
    'RGC_INSPECTION_DB_PORT' => '3306',
    'RGC_INSPECTION_DB_NAME' => 'rgcarsco_peritajes',
    'RGC_INSPECTION_DB_USER' => '',
    'RGC_INSPECTION_DB_PASSWORD' => '',
    'RGC_SUPABASE_URL' => 'https://hqnthnpgiqngokyqgdsw.supabase.co',
    'RGC_SUPABASE_ANON_KEY' => '', // Misma clave pública de config.js; nunca service_role.
    'RGC_INSPECTION_SIGNING_KEY' => '', // 32 bytes aleatorios o más; conservar privada.
    'RGC_SITE_URL' => 'https://rgcars.com.ar',
    'RGC_INSPECTION_STORAGE_ROOT' => '/home2/rgcarsco/rgcars-private/inspections',
];
