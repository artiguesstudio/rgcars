import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();

test('the public recruitment form includes the requested applicant fields', async () => {
  const shared = await readFile(join(root, 'shared.js'), 'utf8');
  for (const field of [
    'full_name',
    'age',
    'marital_status',
    'children_count',
    'has_driving_license',
    'sales_experience_years',
    'automotive_sales_experience',
    'experience',
    'cv',
  ]) {
    assert.match(shared, new RegExp(`name=["']${field}["']`));
  }
  assert.match(shared, /license !== 'yes'/);
  assert.match(shared, /JOB_APPLICATION_MAX_FILE_BYTES = 5 \* 1024 \* 1024/);
  assert.doesNotMatch(shared, /name=["'](?:target_based_sales_experience|crm_experience|full_time_availability)["']/);
});

test('CVs are stored outside the public site and require a private token to download', async () => {
  const endpoint = await readFile(join(root, 'api', 'job-applications.php'), 'utf8');
  assert.match(endpoint, /dirname\(dirname\(__DIR__\)\).*rgcars-private.*job-applications/s);
  assert.match(endpoint, /download_token_hash/);
  assert.match(endpoint, /hash_equals/);
  assert.match(endpoint, /RGC_JOB_DOWNLOAD_TTL_SECONDS/);
  assert.match(endpoint, /verifiedCvMimeType/);
});

test('the recruitment campaign image is referenced from the modal', async () => {
  const shared = await readFile(join(root, 'shared.js'), 'utf8');
  assert.match(shared, /\.\/imagenes\/busqueda-vendedor-rg-cars\.png/);
});

test('the recruitment form has a shareable direct URL', async () => {
  const shared = await readFile(join(root, 'shared.js'), 'utf8');
  assert.match(shared, /RECRUITMENT_DIRECT_HASH = '#postulacion-vendedor'/);
  assert.match(shared, /syncRecruitmentModalWithUrl\(\)/);
  assert.match(shared, /window\.addEventListener\('hashchange', syncRecruitmentModalWithUrl\)/);
});

test('the fit score uses job-relevant criteria and excludes sensitive personal data', async () => {
  const endpoint = await readFile(join(root, 'api', 'job-applications.php'), 'utf8');
  const scoreFunction = endpoint.match(/function calculateApplicantFit\([\s\S]*?\n}\n\nfunction readJsonPayload/)?.[0] || '';
  assert.match(scoreFunction, /Experiencia en ventas/);
  assert.match(scoreFunction, /Experiencia automotriz/);
  assert.doesNotMatch(scoreFunction, /Trabajo por objetivos|Uso de CRM|Disponibilidad full time/);
  assert.doesNotMatch(scoreFunction, /age|edad|marital|estado civil|children|hijos/i);
});

test('admin Leads exposes authenticated applicant ranking and management', async () => {
  const [html, admin, endpoint] = await Promise.all([
    readFile(join(root, 'admin', 'admin.html'), 'utf8'),
    readFile(join(root, 'admin', 'admin.js'), 'utf8'),
    readFile(join(root, 'api', 'job-applications.php'), 'utf8'),
  ]);
  assert.match(html, /data-tab="applications"/);
  assert.match(html, /id="applicantFitFilter"/);
  assert.match(admin, /Perfiles ordenados de mayor a menor afinidad/);
  assert.match(admin, /Number\(b\.fit_score \|\| 0\) - Number\(a\.fit_score \|\| 0\)/);
  assert.match(admin, /data-applicant-save/);
  assert.match(admin, /data-applicant-download/);
  assert.match(endpoint, /requireAdminUser\(\)/);
  assert.match(endpoint, /RGC_STORAGE_ALLOWED_EMAILS/);
});
