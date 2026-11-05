<?php
declare(strict_types=1);

/** Pure inspection domain. Keep behavior in parity with inspections/domain.mjs. */
function rgInspectionConfig(): array
{
    static $config = null;
    if ($config === null) {
        $json = file_get_contents(__DIR__ . '/config.json');
        if ($json === false) throw new RuntimeException('No se pudo cargar la configuración de peritajes.');
        $config = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        rgInspectionValidateConfig($config);
    }
    return $config;
}

function rgInspectionMap($value): array { return is_array($value) || $value instanceof stdClass ? (array)$value : []; }
function rgInspectionIsObject($value): bool { return $value instanceof stdClass || (is_array($value) && !array_is_list($value)); }
function rgInspectionHasValue($value): bool { return $value !== null && $value !== ''; }
function rgInspectionFinite($value): bool { return (is_int($value) || is_float($value)) && is_finite((float)$value); }
function rgInspectionClean($value): string
{
    if (!is_string($value)) return '';
    $value = preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/', '', $value);
    return preg_replace('/^[\s\p{Z}\x{FEFF}]+|[\s\p{Z}\x{FEFF}]+$/u', '', $value) ?? '';
}
function rgInspectionTextLength(string $value): int
{
    // JavaScript validates UTF-16 code units; do not count UTF-8 bytes as characters.
    return preg_match_all('/./us', $value) + preg_match_all('/[\x{10000}-\x{10ffff}]/u', $value);
}
function rgInspectionItems(array $config): array
{
    $items = [];
    foreach ($config['categories'] ?? [] as $category) foreach ($category['items'] ?? [] as $item) $items[] = $item;
    return $items;
}
/** Absent metadata keeps approved historical snapshots on their original rating scale. */
function rgInspectionUsesPercentageScore(array $item): bool { return ($item['scoring'] ?? null) === 'percentage'; }
function rgInspectionValidateConfig($config): array
{
    if (!rgInspectionIsObject($config)) throw new InvalidArgumentException('La configuración requiere ocho categorías.');
    $config = rgInspectionMap($config);
    if (!is_array($config['categories'] ?? null) || count($config['categories']) !== 8) throw new InvalidArgumentException('La configuración requiere ocho categorías.');
    if (!rgInspectionClean($config['version'] ?? null) || !rgInspectionClean($config['scale_version'] ?? null)) throw new InvalidArgumentException('Falta la versión de configuración.');
    $factors = rgInspectionMap($config['factors'] ?? null);
    foreach (['B', 'R', 'M'] as $key) if (!rgInspectionFinite($factors[$key] ?? null) || $factors[$key] < 0 || $factors[$key] > 1) throw new InvalidArgumentException('Escala inválida.');
    $items = rgInspectionItems($config);
    if (count($items) !== 83 || count(array_unique(array_column($items, 'id'))) !== 83) throw new InvalidArgumentException('La configuración requiere 83 identificadores únicos.');
    $maximum = 0;
    foreach ($config['categories'] as $category) {
        if (!rgInspectionFinite($category['max'] ?? null) || $category['max'] <= 0) throw new InvalidArgumentException('Los ocho topes deben sumar 100.');
        $maximum += $category['max'];
    }
    if (count(array_unique(array_column($config['categories'], 'id'))) !== 8 || abs($maximum - 100) > 1e-10) throw new InvalidArgumentException('Los ocho topes deben sumar 100.');
    foreach ($items as $item) if (!rgInspectionFinite($item['weight'] ?? null) || $item['weight'] <= 0 || !in_array($item['type'] ?? null, ['state','windshield','percentage','damage','tire'], true) || !rgInspectionClean($item['label'] ?? null)) throw new InvalidArgumentException('Ítem o ponderación inválidos.');
    foreach ($items as $item) if (array_key_exists('scoring', $item) && ($item['scoring'] !== 'percentage' || $item['type'] !== 'percentage')) throw new InvalidArgumentException('Criterio de puntuación inválido.');
    foreach ($items as $item) if (array_key_exists('details_required', $item) && (!is_bool($item['details_required']) || $item['type'] !== 'tire')) throw new InvalidArgumentException('Requisito de detalles inválido.');
    return $config;
}

function rgInspectionTextField(array &$errors, $value, string $path, array $options = []): void
{
    $required = $options['required'] ?? false; $max = $options['max'] ?? 2000;
    if ($value !== null && !is_string($value)) $errors[] = ['path'=>$path,'message'=>'Debe ser texto.'];
    elseif (is_string($value) && (rgInspectionTextLength($value) > $max || preg_match('/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/', $value))) $errors[] = ['path'=>$path,'message'=>"Texto inválido o mayor a {$max} caracteres."];
    if ($required && rgInspectionClean($value) === '') $errors[] = ['path'=>$path,'message'=>'Completá este campo.'];
}
function rgInspectionNumericField(array &$errors, $value, string $path, array $options = []): void
{
    $min = $options['min'] ?? 0; $max = $options['max'] ?? INF;
    if (rgInspectionHasValue($value) && (!rgInspectionFinite($value) || $value < $min || $value > $max)) $errors[] = ['path'=>$path,'message'=>'Ingresá un número entre ' . $min . ' y ' . ($max === INF ? 'un valor válido' : $max) . '.'];
    if (($options['required'] ?? false) && !rgInspectionHasValue($value)) $errors[] = ['path'=>$path,'message'=>'Completá la medición.'];
}
function rgInspectionKnownKeys(array &$errors, $object, array $keys, string $path): bool
{
    if (!rgInspectionIsObject($object)) { $errors[] = ['path'=>$path,'message'=>'Formato inválido.']; return false; }
    foreach (array_keys(rgInspectionMap($object)) as $key) if (!in_array($key, $keys, true)) $errors[] = ['path'=>"{$path}.{$key}",'message'=>'Campo no reconocido.'];
    return true;
}

function rgInspectionValidateAnswer($answer, array $item, array $options = []): array
{
    $errors = []; $final = $options['final'] ?? false; $allowNA = $options['allowNA'] ?? true;
    $path = 'answers.' . $item['id'];
    if (!rgInspectionIsObject($answer)) return $final ? [['path'=>$path,'message'=>'Ítem pendiente.']] : ($answer === null ? [] : [['path'=>$path,'message'=>'Formato de respuesta inválido.']]);
    rgInspectionKnownKeys($errors, $answer, ['rating','na_reason','notes','value'], $path);
    $answer = rgInspectionMap($answer);
    $rating = $answer['rating'] ?? null;
    if ($rating !== null && !in_array($rating, ['B','R','M','NA'], true)) $errors[] = ['path'=>"{$path}.rating",'message'=>'Valoración inválida.'];
    if ($final && $rating === null && !rgInspectionUsesPercentageScore($item)) $errors[] = ['path'=>"{$path}.rating",'message'=>'Valoración pendiente.'];
    rgInspectionTextField($errors, $answer['notes'] ?? null, "{$path}.notes");
    rgInspectionTextField($errors, $answer['na_reason'] ?? null, "{$path}.na_reason", ['required'=>$final && $rating === 'NA','max'=>1000]);
    if ($rating === 'NA' && !$allowNA) $errors[] = ['path'=>"{$path}.rating",'message'=>'No tenés permiso para usar No aplica.'];
    $required = $final && $rating !== 'NA';
    $value = $answer['value'] ?? (object)[];
    $fields = ['state'=>[], 'windshield'=>['findings'], 'percentage'=>['percent'], 'damage'=>['detail','zone'], 'tire'=>['brand','size','wear_percent','depth_mm']];
    if (!rgInspectionKnownKeys($errors, $value, $fields[$item['type']] ?? [], "{$path}.value")) return $errors;
    $value = rgInspectionMap($value);
    if ($item['type'] === 'windshield') {
        $findings = $value['findings'] ?? null;
        $validList = is_array($findings) && array_is_list($findings);
        $validValues = $validList && count(array_filter($findings, fn($entry)=>in_array($entry,['Sin daños','Fisuras','Impactos'],true))) === count($findings);
        if (array_key_exists('findings', $value) && (!$validList || !$validValues || count(array_unique($findings, SORT_REGULAR)) !== count($findings) || (in_array('Sin daños',$findings,true) && count($findings) > 1))) $errors[] = ['path'=>"{$path}.value.findings",'message'=>'Elegí Sin daños o uno o varios hallazgos, sin combinarlos con Sin daños.'];
        if ($required && (!$validList || count($findings) === 0)) $errors[] = ['path'=>"{$path}.value.findings",'message'=>'Indicá el estado del parabrisas.'];
    }
    if ($item['type'] === 'percentage') rgInspectionNumericField($errors, $value['percent'] ?? null, "{$path}.value.percent", ['required'=>$required,'max'=>100]);
    if ($item['type'] === 'damage') {
        rgInspectionTextField($errors, $value['detail'] ?? null, "{$path}.value.detail", ['required'=>$required]);
        rgInspectionTextField($errors, $value['zone'] ?? null, "{$path}.value.zone", ['required'=>$required && $item['id'] === 'exterior-golpes','max'=>300]);
    }
    if ($item['type'] === 'tire') {
        $detailsRequired = $required && ($item['details_required'] ?? true) !== false;
        rgInspectionTextField($errors, $value['brand'] ?? null, "{$path}.value.brand", ['required'=>$detailsRequired,'max'=>100]);
        rgInspectionTextField($errors, $value['size'] ?? null, "{$path}.value.size", ['required'=>$detailsRequired,'max'=>100]);
        rgInspectionNumericField($errors, $value['wear_percent'] ?? null, "{$path}.value.wear_percent", ['required'=>$detailsRequired,'max'=>100]);
        rgInspectionNumericField($errors, $value['depth_mm'] ?? null, "{$path}.value.depth_mm", ['required'=>$detailsRequired]);
    }
    return $errors;
}

function rgInspectionScore($answers = [], ?array $config = null): array
{
    if (func_num_args() === 0) $answers = (object)[];
    $config = rgInspectionValidateConfig($config ?? rgInspectionConfig());
    $errors = [];
    if (!rgInspectionIsObject($answers)) { $errors[] = ['path'=>'answers','message'=>'Formato de respuestas inválido.']; $answers = []; }
    $answers = rgInspectionMap($answers); $known = array_column(rgInspectionItems($config),'id');
    foreach (array_keys($answers) as $id) if (!in_array($id,$known,true)) $errors[] = ['path'=>"answers.{$id}",'message'=>'Ítem no reconocido.'];
    $categories = [];
    foreach ($config['categories'] as $category) {
        $denominator = 0; $numerator = 0; $pending = 0;
        foreach ($category['items'] as $item) {
            $answer = $answers[$item['id']] ?? null;
            $issues = rgInspectionValidateAnswer($answer,$item,['final'=>true,'allowNA'=>($config['allow_na'] ?? true) !== false]);
            $errors = array_merge($errors,$issues); $answer = rgInspectionMap($answer);
            $excluded = ($answer['rating'] ?? null) === 'NA' && count($issues) === 0;
            if (!$excluded) $denominator += $item['weight'];
            if ($issues) $pending++;
            elseif (!$excluded) $numerator += $item['weight'] * (rgInspectionUsesPercentageScore($item) ? rgInspectionMap($answer['value'])['percent'] / 100 : $config['factors'][$answer['rating']]);
        }
        $nonEvaluable = $denominator == 0; $complete = $pending === 0 && !$nonEvaluable;
        $categories[] = ['id'=>$category['id'],'label'=>$category['label'],'max'=>$category['max'],'denominator'=>$denominator,'numerator'=>$numerator,
            'points'=>$complete ? $category['max'] * $numerator / $denominator : null,'complete'=>$complete,'pending'=>$pending,'non_evaluable'=>$nonEvaluable,
            'evaluated'=>count($category['items'])-$pending,'count'=>count($category['items'])];
    }
    $complete = !$errors && count(array_filter($categories,fn($category)=>$category['complete'])) === count($categories);
    $total = $complete ? min(100,max(0,array_sum(array_column($categories,'points')))) : null;
    return ['complete'=>$complete,'total_100'=>$total,'nota_10'=>$total === null ? null : $total/10,'categories'=>$categories,'errors'=>$errors];
}

function rgInspectionValidDate($value): bool
{
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D',$value)) return false;
    [$year,$month,$day] = array_map('intval',explode('-',$value));
    return checkdate($month,$day,$year);
}
function rgInspectionValidSignedAt($value): bool
{
    // A recorded conformity date must be absolute; strtotime alone accepts "tomorrow".
    return is_string($value) && strlen($value) <= 40
        && preg_match('/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/D',$value) === 1
        && rgInspectionValidDate(substr($value,0,10)) && strtotime($value) !== false;
}
function rgInspectionValidateDocument($document, array $options = []): array
{
    $errors = []; $final = $options['final'] ?? false; $allowNA = $options['allowNA'] ?? true; $config = $options['config'] ?? rgInspectionConfig();
    if (!rgInspectionKnownKeys($errors,$document,['inspection_date','locality','owner','vehicle','inspector_name','show_inspector','observations','internal_notes','fitness','risk','verdict_reason','signature','answers'],'document')) return $errors;
    $document = rgInspectionMap($document);
    rgInspectionTextField($errors,$document['locality'] ?? null,'locality',['required'=>$final,'max'=>200]);
    $date = $document['inspection_date'] ?? null;
    if ((rgInspectionHasValue($date) && !rgInspectionValidDate($date)) || ($final && !rgInspectionHasValue($date))) $errors[] = ['path'=>'inspection_date','message'=>'Ingresá una fecha de inspección válida.'];
    $owner = $document['owner'] ?? (object)[];
    if (rgInspectionKnownKeys($errors,$owner,['name','phone','email'],'owner')) {
        $owner = rgInspectionMap($owner);
        foreach (['name','phone','email'] as $key) rgInspectionTextField($errors,$owner[$key] ?? null,"owner.{$key}",['max'=>200]);
        if (rgInspectionClean($owner['email'] ?? null) && !preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/u',$owner['email'])) $errors[] = ['path'=>'owner.email','message'=>'Email inválido.'];
    }
    $vehicle = $document['vehicle'] ?? (object)[];
    if (rgInspectionKnownKeys($errors,$vehicle,['brand','model','version','plate','km','year'],'vehicle')) {
        $vehicle = rgInspectionMap($vehicle);
        foreach (['brand','model','version','plate'] as $key) rgInspectionTextField($errors,$vehicle[$key] ?? null,"vehicle.{$key}",['required'=>$final && in_array($key,['brand','version','plate'],true),'max'=>200]);
        rgInspectionNumericField($errors,$vehicle['km'] ?? null,'vehicle.km',['required'=>$final]);
        rgInspectionNumericField($errors,$vehicle['year'] ?? null,'vehicle.year',['min'=>1886,'max'=>2200]);
    }
    rgInspectionTextField($errors,$document['inspector_name'] ?? null,'inspector_name',['required'=>$final,'max'=>200]);
    rgInspectionTextField($errors,$document['observations'] ?? null,'observations',['max'=>8000]);
    rgInspectionTextField($errors,$document['internal_notes'] ?? null,'internal_notes',['max'=>8000]);
    rgInspectionTextField($errors,$document['verdict_reason'] ?? null,'verdict_reason',['required'=>$final,'max'=>4000]);
    foreach (['fitness'=>['Apto','No apto'],'risk'=>['Bajo','Medio','Alto']] as $key=>$values) {
        $value = $document[$key] ?? null;
        if ((rgInspectionHasValue($value) && !in_array($value,$values,true)) || ($final && !in_array($value,$values,true))) $errors[] = ['path'=>$key,'message'=>'El perito debe emitir este dictamen explícitamente.'];
    }
    if (array_key_exists('show_inspector',$document) && !is_bool($document['show_inspector'])) $errors[] = ['path'=>'show_inspector','message'=>'Autorización inválida.'];
    $signature = $document['signature'] ?? (object)[];
    if (rgInspectionKnownKeys($errors,$signature,['name','signed_at','consent_public','image_data_url'],'signature')) {
        $signature = rgInspectionMap($signature);
        rgInspectionTextField($errors,$signature['name'] ?? null,'signature.name',['required'=>$final,'max'=>200]);
        $signedAt = $signature['signed_at'] ?? null;
        if (rgInspectionHasValue($signedAt) && !rgInspectionValidSignedAt($signedAt)) $errors[] = ['path'=>'signature.signed_at','message'=>'Fecha de conformidad inválida.'];
        elseif ($final && !rgInspectionHasValue($signedAt)) $errors[] = ['path'=>'signature.signed_at','message'=>'Falta fecha de conformidad.'];
        if (array_key_exists('consent_public',$signature) && !is_bool($signature['consent_public'])) $errors[] = ['path'=>'signature.consent_public','message'=>'Consentimiento inválido.'];
        $png = $signature['image_data_url'] ?? null;
        if (rgInspectionHasValue($png) && (!is_string($png) || strlen($png)>200000 || !preg_match('#^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$#D',$png))) $errors[] = ['path'=>'signature.image_data_url','message'=>'La firma debe ser una imagen PNG de hasta 150 KB.'];
        elseif ($final && !rgInspectionHasValue($png)) $errors[] = ['path'=>'signature.image_data_url','message'=>'Capturá la firma electrónica del perito.'];
    }
    if (!rgInspectionIsObject($document['answers'] ?? null)) $errors[] = ['path'=>'answers','message'=>'Formato de respuestas inválido.'];
    else {
        $answers = rgInspectionMap($document['answers']); $items = rgInspectionItems($config); $known = array_column($items,'id');
        foreach (array_keys($answers) as $key) if (!in_array($key,$known,true)) $errors[] = ['path'=>"answers.{$key}",'message'=>'Ítem no reconocido.'];
        foreach ($items as $item) $errors = array_merge($errors,rgInspectionValidateAnswer($answers[$item['id']] ?? null,$item,['final'=>$final,'allowNA'=>$allowNA && ($config['allow_na'] ?? true) !== false]));
        if ($final) foreach (rgInspectionScore($answers,$config)['categories'] as $category) if ($category['non_evaluable']) $errors[] = ['path'=>'categories.'.$category['id'],'message'=>'Categoría no evaluable: requiere revisión manual. No se redistribuyen sus puntos.'];
    }
    return $errors;
}

function rgInspectionCreateDocument(array $vehicle = []): array
{
    $optionalNumber = static fn($value)=>rgInspectionHasValue($value) && (is_numeric($value) || is_bool($value)) && is_finite((float)$value) ? 0+$value : null;
    $answers = [];
    foreach (rgInspectionItems(rgInspectionConfig()) as $item) $answers[$item['id']] = ['rating'=>null,'na_reason'=>'','notes'=>'','value'=>(object)[]];
    return ['inspection_date'=>'','locality'=>'Río Grande, Tierra del Fuego','owner'=>['name'=>'','phone'=>'','email'=>''],
        'vehicle'=>['brand'=>rgInspectionClean($vehicle['brand'] ?? null),'model'=>rgInspectionClean($vehicle['model'] ?? null),'version'=>rgInspectionClean(($vehicle['version'] ?? '') ?: (($vehicle['model'] ?? '') ?: ($vehicle['title'] ?? ''))),'plate'=>rgInspectionClean($vehicle['plate'] ?? null),'km'=>$optionalNumber($vehicle['km'] ?? null),'year'=>$optionalNumber($vehicle['year'] ?? null)],
        'inspector_name'=>'','show_inspector'=>false,'observations'=>'','internal_notes'=>'','fitness'=>null,'risk'=>null,'verdict_reason'=>'',
        'signature'=>['name'=>'','signed_at'=>'','consent_public'=>false,'image_data_url'=>''],'answers'=>$answers];
}

class RGInspectionValidationException extends RuntimeException
{
    public array $details;
    public function __construct(array $details) { parent::__construct('El peritaje está incompleto o es inválido.'); $this->details=$details; }
}
function rgInspectionCreateSnapshot(array $document, ?array $config = null): array
{
    $config = $config ?? rgInspectionConfig();
    $errors = rgInspectionValidateDocument($document,['final'=>true,'config'=>$config]);
    if ($errors) throw new RGInspectionValidationException($errors);
    // PHP arrays use copy-on-write; JSON roundtrip also detaches any supplied objects.
    $snapshot = json_decode(json_encode(['version'=>$config['version'],'config'=>$config,'answers'=>$document['answers'],'score'=>rgInspectionScore($document['answers'],$config)],JSON_THROW_ON_ERROR),true,512,JSON_THROW_ON_ERROR);
    foreach ($snapshot['answers'] as &$answer) if (($answer['value'] ?? null) === []) $answer['value'] = (object)[];
    unset($answer);
    return $snapshot;
}
function rgInspectionAuthorize(array $capabilities, string $action): bool
{
    if ($action === 'public') return true;
    if (in_array($action,['approve','publish','archive'],true)) return ($capabilities['can_approve'] ?? false) === true;
    if (in_array($action,['create','save','upload_evidence','delete_evidence','update_evidence','review','return_draft'],true)) return ($capabilities['can_edit'] ?? false) === true;
    if (in_array($action,['capabilities','get','list'],true)) return ($capabilities['can_edit'] ?? false) === true || ($capabilities['can_approve'] ?? false) === true;
    if ($action === 'na') return ($capabilities['can_edit'] ?? false) === true && ($capabilities['can_na'] ?? false) === true;
    return false;
}
function rgInspectionCanTransition(string $from, string $to, array $capabilities = []): bool
{
    if ($to === 'archived') return in_array($from,['draft','in_review','approved','published'],true) && rgInspectionAuthorize($capabilities,'archive');
    $action = ['draft:in_review'=>'review','in_review:draft'=>'return_draft','in_review:approved'=>'approve','approved:published'=>'publish'][$from.':'.$to] ?? null;
    return $action !== null && rgInspectionAuthorize($capabilities,$action);
}

function rgInspectionAnswerProjection($answer, array $item): array
{
    $answer = rgInspectionMap($answer); $value = rgInspectionMap($answer['value'] ?? null); $projected = [];
    if ($item['type'] === 'windshield') $projected['findings'] = is_array($value['findings'] ?? null) ? array_values(array_filter($value['findings'],fn($entry)=>in_array($entry,['Sin daños','Fisuras','Impactos'],true))) : [];
    if ($item['type'] === 'percentage') $projected['percent'] = rgInspectionFinite($value['percent'] ?? null) ? $value['percent'] : null;
    if ($item['type'] === 'damage') { $projected['detail'] = rgInspectionClean($value['detail'] ?? null); $projected['zone'] = rgInspectionClean($value['zone'] ?? null); }
    if ($item['type'] === 'tire') {
        $projected['brand'] = rgInspectionClean($value['brand'] ?? null); $projected['size'] = rgInspectionClean($value['size'] ?? null);
        $projected['wear_percent'] = rgInspectionFinite($value['wear_percent'] ?? null) ? $value['wear_percent'] : null;
        $projected['depth_mm'] = rgInspectionFinite($value['depth_mm'] ?? null) ? $value['depth_mm'] : null;
    }
    return ['rating'=>in_array($answer['rating'] ?? null,['B','R','M','NA'],true) ? $answer['rating'] : null,'na_reason'=>rgInspectionClean($answer['na_reason'] ?? null),'notes'=>rgInspectionClean($answer['notes'] ?? null),'value'=>$projected ?: (object)[]];
}
function rgInspectionProjectReport(array $row, array $evidence, bool $internal): ?array
{
    if (!rgInspectionIsObject($row['document'] ?? null)) return null;
    $document = rgInspectionMap($row['document']); $snapshot = rgInspectionMap($row['scoring_snapshot'] ?? null);
    $config = $snapshot['config'] ?? rgInspectionConfig(); $answers = $snapshot['answers'] ?? $document['answers'] ?? null;
    $score = rgInspectionScore($answers,$config); $answers = rgInspectionMap($answers); $vehicle = rgInspectionMap($document['vehicle'] ?? null);
    $projection = [];
    foreach (rgInspectionItems($config) as $item) $projection[$item['id']] = rgInspectionAnswerProjection($answers[$item['id']] ?? null,$item);
    $photos = [];
    foreach ($evidence as $entry) if ($internal || ($entry['approved_public'] ?? false) === true) $photos[] = ['id'=>(string)($entry['id'] ?? ''),'item_id'=>rgInspectionClean($entry['item_id'] ?? null),'caption'=>rgInspectionClean($entry['caption'] ?? null),'url'=>rgInspectionClean(($entry['signed_url'] ?? '') ?: ($entry['url'] ?? '')),'approved_public'=>($entry['approved_public'] ?? false) === true];
    $report = ['id'=>(string)$row['id'],'vehicle_id'=>(string)$row['vehicle_id'],'revision'=>$row['revision'] ?? null,'status'=>$row['status'],'version'=>$snapshot['version'] ?? $config['version'],
        'approved_at'=>$row['approved_at'] ?? null,'published_at'=>$row['published_at'] ?? null,'inspection_date'=>rgInspectionClean($document['inspection_date'] ?? null),'locality'=>rgInspectionClean($document['locality'] ?? null),
        'vehicle'=>['brand'=>rgInspectionClean($vehicle['brand'] ?? null),'model'=>rgInspectionClean($vehicle['model'] ?? null),'version'=>rgInspectionClean($vehicle['version'] ?? null),'plate'=>rgInspectionClean($vehicle['plate'] ?? null),'km'=>rgInspectionFinite($vehicle['km'] ?? null) ? $vehicle['km'] : null,'year'=>rgInspectionFinite($vehicle['year'] ?? null) ? $vehicle['year'] : null],
        'observations'=>rgInspectionClean($document['observations'] ?? null),'fitness'=>$document['fitness'] ?? null,'risk'=>$document['risk'] ?? null,'verdict_reason'=>rgInspectionClean($document['verdict_reason'] ?? null),
        'config'=>$config,'answers'=>$projection,'score'=>$score,'evidence'=>$photos];
    if ($internal || ($document['show_inspector'] ?? false) === true) { $report['inspector_name'] = rgInspectionClean($document['inspector_name'] ?? null); $report['show_inspector'] = ($document['show_inspector'] ?? false) === true; }
    $signature = rgInspectionMap($document['signature'] ?? null);
    if ($internal || ($signature['consent_public'] ?? false) === true) $report['signature'] = ['name'=>rgInspectionClean($signature['name'] ?? null),'signed_at'=>rgInspectionClean($signature['signed_at'] ?? null),'image_data_url'=>rgInspectionClean($signature['image_data_url'] ?? null),'consent_public'=>($signature['consent_public'] ?? false) === true];
    if ($internal) { $report['owner'] = $document['owner'] ?? (object)[]; $report['internal_notes'] = rgInspectionClean($document['internal_notes'] ?? null); }
    return $report;
}
function rgInspectionPublicReport(?array $row, array $evidence = [], array $options = []): ?array
{
    if (!$row || !in_array($row['status'] ?? null,($options['preview'] ?? false) ? ['approved','published','archived'] : ['published'],true) || empty($row['scoring_snapshot']) || empty($row['approved_at'])) return null;
    $report = rgInspectionProjectReport($row,$evidence,false);
    if (!$report || !$report['score']['complete'] || !in_array($report['fitness'],['Apto','No apto'],true) || !in_array($report['risk'],['Bajo','Medio','Alto'],true)) return null;
    return $report;
}
function rgInspectionInternalReport(?array $row, array $evidence = []): ?array { return $row ? rgInspectionProjectReport($row,$evidence,true) : null; }
