/**
 * Dx Enfermería v3
 * NANDA-I 2024-2026 (términos exactos del libro)
 * NIC 8ª ed · NOC 7ª ed (indicadores seleccionables)
 * GPC con clave institucional (IMSS/SSA/CENETEC)
 * GPC CKM 2026 AHA/ACC/ADA/ASN (solo si califica)
 * Tratamiento 1ª y 2ª elección con dosis por peso
 */
const http  = require('http');
const https = require('https');
const PORT  = process.env.PORT || 3000;

// ── utilidades ────────────────────────────────────────────────
function readBody(req) {
  return new Promise((res, rej) => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end',  () => res(d));
    req.on('error', rej);
  });
}
function sendJSON(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(b),
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(b);
}
function callAnthropic(apiKey, system, user) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system,
      messages: [{ role: 'user', content: user }]
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    }, r => {
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => {
        try {
          const d = JSON.parse(raw);
          if (d.error) return reject(new Error(d.error.message));
          resolve((d.content||[]).filter(b=>b.type==='text').map(b=>b.text).join(''));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ══════════════════════════════════════════════════════════════
// PROMPTS
// ══════════════════════════════════════════════════════════════

// ── PASO 1: NANDA-I con términos EXACTOS del libro ────────────
const SYS_NANDA = `Eres experto certificado en NANDA-I 2024-2026. Conoces TODOS los terminos oficiales del libro.

RESTRICCION ESTRICTA: Para construir cada diagnostico NANDA-I debes usar EXCLUSIVAMENTE los terminos textuales exactos que aparecen en el libro oficial NANDA-I 2024-2026:
- Para "factores_relacionados" (r/c): usa SOLO terminos del apartado oficial "Factores Relacionados" de la etiqueta diagnostica
- Para "caracteristicas_definitorias" (m/p): usa SOLO terminos del apartado oficial "Caracteristicas Definitorias" de la etiqueta diagnostica
- NO inventar texto libre ni parafrasear. Selecciona los terminos oficiales con mayor correspondencia clinica a los signos y sintomas del paciente.

Genera los 3 diagnosticos de enfermeria mas prioritarios. Para cada uno:
- nanda_codigo: codigo oficial (ej: 00132)
- nanda_nombre: nombre oficial exacto de la etiqueta
- nanda_dominio: numero y nombre del dominio
- nanda_clase: numero y nombre de la clase
- prioridad: alta / media / baja
- justificacion: 1 oracion clinica breve
- factores_relacionados: array max 3, TERMINOS EXACTOS del libro NANDA-I del apartado Factores Relacionados
- caracteristicas_definitorias: array max 4, TERMINOS EXACTOS del libro NANDA-I del apartado Caracteristicas Definitorias
- noc: array de 2 resultados NOC 7a ed, cada uno con: codigo, nombre, descripcion_breve, indicadores (array de 5 objetos: codigo_indicador, nombre_indicador, escala_medicion, puntuacion_diana)
- nic: array de 2 intervenciones NIC 8a ed, cada una con: codigo, nombre, objetivo (1 oracion medible con plazo), indicadores_evaluacion (array max 3: indicador, basal, meta, frecuencia), actividades (array 4 actividades especificas)
- padecimiento_principal: 3-5 palabras clave
- ckm_aplica: true si tiene DM2+HTA, DM2+dislipidemia, DM2+obesidad, DM2+ERC, HTA+obesidad+dislipidemia; false en caso contrario

SOLO JSON valido sin backticks:
{"padecimiento_principal":"...","ckm_aplica":false,"diagnosticos":[{"prioridad":"alta","nanda_codigo":"00xxx","nanda_nombre":"...","nanda_dominio":"...","nanda_clase":"...","justificacion":"...","factores_relacionados":["termino exacto libro NANDA-I"],"caracteristicas_definitorias":["termino exacto libro NANDA-I"],"noc":[{"codigo":"xxxx","nombre":"...","descripcion_breve":"...","indicadores":[{"codigo_indicador":"xxxxxx","nombre_indicador":"...","escala_medicion":"...","puntuacion_diana":"..."}]}],"nic":[{"codigo":"xxxx","nombre":"...","objetivo":"...","indicadores_evaluacion":[{"indicador":"...","basal":"...","meta":"...","frecuencia":"..."}],"actividades":["...","...","...","..."]}]}]}`;

// ── PASO 2: GPC con clave institucional + tratamiento 1a y 2a eleccion ──
const SYS_GPC = `Eres experto en Guias de Practica Clinica (GPC) mexicanas e internacionales.
Tu tarea es identificar la GPC mas especifica y actualizada para el padecimiento del paciente.

OBLIGATORIO incluir:
1. gpc_nombre_completo: nombre completo oficial de la guia
2. gpc_clave: clave institucional exacta (ejemplos: GPC-IMSS-xxx-xx, SSA-GPC-xxx, CENETEC-GPC-xxx, NICE-NGxxx, ACC/AHA-xxxx)
3. gpc_institucion: institucion emisora completa
4. gpc_año: año de publicacion o ultima actualizacion
5. gpc_version: version o edicion si aplica
6. recomendacion_principal: la recomendacion mas relevante para enfermeria con nivel de evidencia (max 3 oraciones)
7. nivel_evidencia: nivel segun la guia (A, B, C, I, IIa, IIb, III, o escala GRADE)
8. punto_buena_practica: punto de buena practica especifico de enfermeria (max 2 oraciones)
9. advertencia_clinica: advertencia importante para este paciente (1 oracion)
10. primera_eleccion: array de farmacos de primera linea segun GPC, cada uno con:
    nombre, dci (denominacion comun internacional), clase_farmacologica,
    dosis_adulto, dosis_calculada_paciente (calcula con el peso si se proporciona, muestra formula: ej "15mg/kg x 70kg = 1050mg"),
    via, frecuencia, duracion, mecanismo_accion_breve, contraindicaciones_principales, meta_terapeutica
11. segunda_eleccion: array de farmacos alternativos o de segunda linea segun GPC, mismos campos que primera_eleccion
    mas: razon_segunda_linea (por que es segunda opcion)

SOLO JSON sin backticks:
{"gpc_nombre_completo":"...","gpc_clave":"...","gpc_institucion":"...","gpc_año":"...","gpc_version":"...","recomendacion_principal":"...","nivel_evidencia":"...","punto_buena_practica":"...","advertencia_clinica":"...","primera_eleccion":[{"nombre":"...","dci":"...","clase_farmacologica":"...","dosis_adulto":"...","dosis_calculada_paciente":"...","via":"...","frecuencia":"...","duracion":"...","mecanismo_accion_breve":"...","contraindicaciones_principales":"...","meta_terapeutica":"..."}],"segunda_eleccion":[{"nombre":"...","dci":"...","clase_farmacologica":"...","dosis_adulto":"...","dosis_calculada_paciente":"...","via":"...","frecuencia":"...","duracion":"...","mecanismo_accion_breve":"...","contraindicaciones_principales":"...","meta_terapeutica":"...","razon_segunda_linea":"..."}]}`;

// ── PASO 3A: CKM — estadificacion y recomendaciones (solo si califica) ──
const SYS_CKM_A = `Eres experto en la Guia CKM 2026 AHA/ACC/ADA/ASN (Cardiovascular-Kidney-Metabolic Syndrome Guideline).
Este paciente HA SIDO CONFIRMADO como candidato al sindrome CKM.
Proporciona:
- ckm_estadio: "Estadio 0", "Estadio 1", "Estadio 2", "Estadio 3" o "Estadio 4"
- ckm_estadio_justificacion: justificacion clinica del estadio en 1 oracion
- prevent_riesgo_10a: riesgo cardiovascular a 10 años segun ecuacion PREVENT AHA 2023 (ej: "~22%")
- prevent_riesgo_30a: riesgo a 30 años (ej: "~48%")
- recomendacion: recomendacion principal CKM 2026 para este paciente en 2 oraciones
- nivel_evidencia: "A", "B-R", "B-NR" o "C-LD"
- punto_buena_practica: punto especifico de enfermeria CKM en 2 oraciones
- advertencia_clinica: advertencia clinica importante en 1 oracion
SOLO JSON sin backticks:
{"ckm_estadio":"...","ckm_estadio_justificacion":"...","prevent_riesgo_10a":"...","prevent_riesgo_30a":"...","recomendacion":"...","nivel_evidencia":"...","punto_buena_practica":"...","advertencia_clinica":"..."}`;

// ── PASO 3B: CKM — farmacos cardioprotectores ─────────────────
const SYS_CKM_B = `Eres experto en la Guia CKM 2026 AHA/ACC/ADA/ASN.
Genera el tratamiento farmacologico cardioprotector segun CKM 2026. Max 4 farmacos primera linea, max 3 segunda linea.
Prioridad primera linea: SGLT2i (empagliflozina 10mg o dapagliflozina 10mg) si DM2+ECV/ERC, GLP-1 RA (semaglutida/liraglutida) si obesidad+DM2, RASi si ERC+HTA+albuminuria, estatina alta intensidad si ASCVD o riesgo >7.5%.
Segunda linea: nsMRA (finerenona) si ERC+DM2+albuminuria, antihipertensivo adicional, hipoglucemiante alternativo.
Para cada farmaco: nombre, dci, clase_farmacologica (sigla: SGLT2i/GLP-1RA/RASi/estatina/nsMRA/CCB),
linea (primera/segunda), indicacion_ckm (razon segun guia CKM en 8 palabras max),
dosis_calculada (con formula si hay peso: "10mg fijo" o "0.5mg SC semanal"),
via, frecuencia, duracion, observaciones_clinicas (12 palabras max), meta_terapeutica.
SOLO JSON sin backticks:
{"primera_eleccion_ckm":[{"nombre":"...","dci":"...","clase_farmacologica":"...","indicacion_ckm":"...","dosis_calculada":"...","via":"...","frecuencia":"...","duracion":"...","observaciones_clinicas":"...","meta_terapeutica":"..."}],"segunda_eleccion_ckm":[{"nombre":"...","dci":"...","clase_farmacologica":"...","indicacion_ckm":"...","dosis_calculada":"...","via":"...","frecuencia":"...","duracion":"...","observaciones_clinicas":"...","meta_terapeutica":"..."}]}`;


// ── PRESCRIPCIÓN ENFERMERÍA — Acuerdo DOF / Art. 28 Bis LGS ─────────
const SYS_ENF_RX = `Eres experto en la legislacion mexicana de prescripcion de medicamentos por enfermeria.
Conoces el ACUERDO DOF que emite los Lineamientos del procedimiento para prescripcion de medicamentos por Licenciados en Enfermeria y Pasantes (Art. 28 Bis Ley General de Salud), CAPITULO III.

Con base en los diagnosticos NANDA-I y el padecimiento del paciente, identifica los medicamentos que aplican de la lista oficial clasificados por modalidad:

MODALIDAD I = Prescripcion Inicial o Autonoma (Licenciado en Enfermeria puede prescribir de forma independiente)
MODALIDAD C = Prescripcion Colaborativa (requiere colaboracion con medico u otro profesional de salud)
MODALIDAD ERA/EPA = Prescripcion por Enfermera de Rol Ampliado o Enfermera de Practica Avanzada (autonoma para EPA/ERA)

Lista oficial de grupos terapeuticos autorizados (incluye pero no se limita a):
MODALIDAD I (autonoma): Sueros orales de rehidratacion, soluciones glucosadas orales, antipiréticos (paracetamol, metamizol), analgesicos menores, antihistaminicos de primera generacion, descongesionantes nasales topicos, antifungicos topicos, antisepticos topicos, vitaminas y minerales, hierro oral, acido folico, material de curacion, insulina (aplicacion y ajuste de dosis segun esquema medico), vacunas segun esquema, oximetria y oxigeno suplementario segun protocolo.
MODALIDAD C (colaborativa): Antibioticos sistemicos, antihipertensivos, hipoglucemiantes orales, broncodilatadores, corticosteroides, diureticos, anticoagulantes, analgesicos opioides, antieméticos sistemicos, sales de rehidratacion IV, medicamentos para manejo del dolor cronico.
MODALIDAD ERA/EPA (rol ampliado/practica avanzada): Todo lo anterior mas: medicamentos de segunda linea, manejo de enfermedades cronicas complejas (DM2, HTA, ICC, EPOC), prescripcion en urgencias y atencion primaria avanzada.

Para cada medicamento que aplique al caso clinico del paciente proporciona:
- nombre: nombre comercial y DCI
- grupo_terapeutico: grupo al que pertenece
- modalidad: "I", "C" o "ERA/EPA"
- indicacion_caso: por que aplica a este paciente especifico (1 oracion)
- dosis_enfermeria: dosis que puede indicar enfermeria segun el acuerdo
- via: via de administracion
- frecuencia
- duracion
- observacion_legal: nota legal importante sobre la prescripcion (ej: "Requiere expediente clinico y firma del medico colaborador", "Solo con protocolo institucional vigente")
- nivel_supervision: "Autonoma", "Colaborativa con medico", "Solo EPA/ERA certificada"

Genera solo los medicamentos pertinentes al caso. Maximo 8 medicamentos en total entre todas las modalidades.
Ordena primero Modalidad I, luego C, luego ERA/EPA.

SOLO JSON sin backticks:
{"base_legal":"Acuerdo DOF - Lineamientos prescripcion enfermeria Art. 28 Bis LGS - Capitulo III","medicamentos":[{"nombre":"...","dci":"...","grupo_terapeutico":"...","modalidad":"I","indicacion_caso":"...","dosis_enfermeria":"...","via":"...","frecuencia":"...","duracion":"...","observacion_legal":"...","nivel_supervision":"..."}]}`;

// ── detección CKM ─────────────────────────────────────────────
function isCKMPatient(history, symptoms) {
  const t = (history + ' ' + symptoms).toLowerCase();
  const keys = ['dm2','diabetes','dislipidemia','hiperlipidemia','colesterol',
    'triglicerido','obesidad','sobrepeso','hta','hipertension','hipertensión',
    'renal','ckd','albuminuria','cardiovascular','insuficiencia cardiaca'];
  return keys.filter(k => t.includes(k)).length >= 2;
}

// ══════════════════════════════════════════════════════════════
// HTML
// ══════════════════════════════════════════════════════════════
const HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dx Enfermería v3 · NANDA-I · NIC · NOC · GPC · CKM 2026</title>
<style>
:root{
  --bg:#F5F3EE;--card:#fff;--brd:#E2DDD6;--b2:#CEC8BF;
  --tx:#1A1714;--t2:#5C5650;--t3:#9C9590;
  --ac:#2D5A8E;--acl:#EBF0F8;
  --gn:#1A6B4A;--gnl:#E6F4EE;--gnb:#9FD9BC;
  --am:#8B5E00;--aml:#FDF3DC;--amb:#E8C96A;
  --rd:#8B2020;--rdl:#FAEAEA;
  --pu:#4A2D8B;--pul:#EDE8F8;
  --ckm:#1A4A6B;--ckml:#E3EEF8;--ckmb:#7AAFD4;
  --r:12px;--rs:8px;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--tx);min-height:100vh}
.hdr{background:var(--tx);padding:13px 18px;display:flex;align-items:center;gap:11px;position:sticky;top:0;z-index:50;box-shadow:0 2px 8px rgba(0,0,0,.2)}
.hdr-ic{width:34px;height:34px;background:var(--ac);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0}
.hdr h1{font-size:15px;color:#fff;font-weight:700;line-height:1.2}
.hdr p{font-size:10px;color:#9C9590;letter-spacing:.04em}
.v3-pill{background:var(--gn);color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:99px;margin-left:auto;white-space:nowrap}
.wrap{max-width:860px;margin:0 auto;padding:18px 15px 80px}
.card{background:var(--card);border:1px solid var(--brd);border-radius:var(--r);padding:18px;margin-bottom:15px;box-shadow:0 1px 4px rgba(0,0,0,.05)}
.card-title{font-size:14px;font-weight:700;color:var(--t2);margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--brd);display:flex;align-items:center;gap:7px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:11px}
.g2 .full{grid-column:1/-1}
.fg{display:flex;flex-direction:column;gap:5px}
.fg label{font-size:11px;font-weight:700;color:var(--t2);letter-spacing:.05em;text-transform:uppercase}
.fg input,.fg select,.fg textarea{border:1.5px solid var(--brd);border-radius:var(--rs);padding:9px 12px;font-size:14px;font-family:inherit;color:var(--tx);background:var(--bg);width:100%;transition:border-color .15s}
.fg input:focus,.fg select:focus,.fg textarea:focus{outline:none;border-color:var(--ac);background:#fff}
.fg textarea{resize:vertical;min-height:90px;line-height:1.55}
.hint{font-size:11px;color:var(--t3);margin-top:3px;line-height:1.5}
.chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
.chip{font-size:11px;padding:3px 8px;border-radius:99px;border:1px solid var(--b2);color:var(--t2);background:var(--bg);cursor:pointer;transition:all .12s;font-family:inherit}
.chip:hover{background:var(--acl);border-color:var(--ac);color:var(--ac)}
.chip:disabled{opacity:.35;cursor:default}
.brow{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
.btn-main{width:100%;background:var(--ac);color:#fff;border:none;border-radius:var(--rs);padding:13px 18px;font-size:15px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:all .18s;font-family:inherit}
.btn-main:hover{background:#1e3f66;transform:translateY(-1px);box-shadow:0 4px 18px rgba(0,0,0,.12)}
.btn-main:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}
.btn-s{font-size:12px;font-weight:600;padding:6px 12px;border-radius:var(--rs);border:1.5px solid var(--b2);background:var(--card);color:var(--t2);cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:5px;transition:all .12s}
.btn-s:hover{border-color:var(--ac);color:var(--ac)}
.btn-s.p{background:var(--ac);color:#fff;border-color:var(--ac)}
.btn-s.p:hover{background:#1e3f66}
/* LOADING */
.ld{display:none;padding:14px 0}
.ld.on{display:block}
.step{display:flex;align-items:center;gap:10px;padding:7px 0;font-size:13px;color:var(--t2)}
.dot{width:17px;height:17px;border-radius:50%;border:2px solid var(--b2);border-top-color:var(--ac);animation:spin .75s linear infinite;flex-shrink:0}
.dot.ok{animation:none;background:var(--gn);border-color:var(--gn);position:relative}
.dot.ok::after{content:'✓';color:#fff;font-size:10px;font-weight:800;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}
@keyframes spin{to{transform:rotate(360deg)}}
#out{display:none}
#out.on{display:block}
/* PATIENT BANNER */
.pb{background:var(--tx);border-radius:var(--r);padding:14px 16px;margin-bottom:15px;display:flex;flex-wrap:wrap;gap:6px}
.pb h3{font-size:14px;color:#fff;font-weight:700;width:100%;margin-bottom:3px}
.ptag{font-size:11px;padding:3px 8px;border-radius:99px;background:rgba(255,255,255,.1);color:rgba(255,255,255,.85);font-weight:500}
.ptag.w{background:rgba(255,160,0,.22);color:#FFCF60}
.ptag.ckm{background:rgba(122,175,212,.3);color:#B8DAF0;font-weight:700}
/* SECTION LABEL */
.sl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--t3);margin:22px 0 10px;display:flex;align-items:center;gap:8px}
.sl::after{content:'';flex:1;height:1px;background:var(--brd)}
/* CKM BANNER */
.ckm-banner{background:var(--ckm);border-radius:var(--r);padding:14px 17px;margin-bottom:15px}
.ckm-banner h4{font-size:13px;color:#fff;font-weight:700;margin-bottom:5px;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.ckm-stage{display:inline-flex;align-items:center;background:rgba(255,255,255,.2);border-radius:99px;padding:3px 11px;font-size:11px;font-weight:700;color:#fff;border:1px solid rgba(255,255,255,.25)}
.ckm-banner p{font-size:12px;color:#B8DAF0;line-height:1.6}
.prev-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:9px}
.prev-box{background:rgba(255,255,255,.1);border-radius:var(--rs);padding:9px;text-align:center}
.prev-val{font-size:20px;font-weight:700;color:#fff}
.prev-lbl{font-size:10px;color:#B8DAF0;margin-top:2px}
/* DX CARD */
.dx{background:var(--card);border:1px solid var(--brd);border-radius:var(--r);margin-bottom:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.dx-top{padding:14px 16px;cursor:pointer;display:flex;gap:11px;align-items:flex-start;border-bottom:1px solid var(--brd);transition:background .12s}
.dx-top:hover{background:var(--bg)}
.bgs{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:4px}
.bg{font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px}
.b-n{background:var(--pul);color:var(--pu)}
.b-a{background:var(--rdl);color:var(--rd)}
.b-m{background:var(--aml);color:var(--am)}
.b-b{background:var(--gnl);color:var(--gn)}
.dx-name{font-size:15px;font-weight:700;line-height:1.3;color:var(--tx)}
.dx-sub{font-size:11px;color:var(--t3);margin-top:2px;font-family:monospace}
.chev{color:var(--t3);font-size:17px;transition:transform .2s;flex-shrink:0;margin-top:2px;user-select:none}
.chev.o{transform:rotate(180deg)}
.dx-body{max-height:0;overflow:hidden;transition:max-height .35s ease}
.dx-body.o{max-height:12000px}
.dx-inner{padding:16px;display:flex;flex-direction:column;gap:16px}
/* DIAGNOSTICO ESTRUCTURADO */
.dx-struct{background:var(--pul);border-radius:var(--rs);padding:12px 14px;border-left:3px solid var(--pu)}
.dx-struct .ds-row{display:flex;gap:8px;margin-bottom:6px;font-size:13px;line-height:1.5}
.dx-struct .ds-row:last-child{margin-bottom:0}
.ds-label{font-weight:700;color:var(--pu);flex-shrink:0;min-width:80px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;padding-top:1px}
.ds-val{color:var(--tx)}
.jf{background:var(--bg);border-left:3px solid var(--ac);padding:10px 13px;border-radius:0 var(--rs) var(--rs) 0;font-size:13px;color:var(--t2);line-height:1.65}
.sub{display:flex;flex-direction:column;gap:7px}
.stl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;display:flex;align-items:center;gap:5px}
.c-p{color:var(--pu)}.c-g{color:var(--gn)}.c-a{color:var(--ac)}.c-m{color:var(--t3)}.c-ckm{color:var(--ckm)}
.tags{display:flex;flex-wrap:wrap;gap:5px}
.tag{font-size:12px;padding:3px 9px;border-radius:99px;border:1px solid var(--brd);color:var(--t2);background:var(--bg)}
.t-g{background:var(--gnl);color:var(--gn);border-color:var(--gnb)}
.t-a{background:var(--acl);color:var(--ac);border-color:#B3CBE8}
.t-p{background:var(--pul);color:var(--pu);border-color:#C2B5E8}
/* NOC CON INDICADORES SELECCIONABLES */
.noc-block{border:1px solid var(--gnb);border-radius:var(--rs);overflow:hidden;margin-bottom:8px}
.noc-head{background:var(--gnl);padding:8px 12px;display:flex;align-items:center;gap:8px}
.noc-code{font-family:monospace;font-size:11px;font-weight:700;background:var(--gn);color:#fff;padding:2px 7px;border-radius:4px;flex-shrink:0}
.noc-name{font-size:13px;font-weight:700;color:var(--gn)}
.noc-desc{font-size:12px;color:var(--t2);padding:8px 12px;border-bottom:1px solid var(--gnb);font-style:italic;background:#FAFFF9}
.noc-ind-wrap{padding:10px 12px}
.noc-ind-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--gn);margin-bottom:8px;display:flex;align-items:center;justify-content:space-between}
.noc-ind-title span{font-size:10px;color:var(--t3);font-weight:400;text-transform:none}
.ind-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.ind-item{display:flex;align-items:flex-start;gap:7px;padding:6px 8px;border:1px solid var(--brd);border-radius:6px;cursor:pointer;transition:all .12s;background:var(--bg)}
.ind-item:hover{border-color:var(--gn);background:var(--gnl)}
.ind-item.selected{border-color:var(--gn);background:var(--gnl);box-shadow:0 0 0 2px rgba(26,107,74,.15)}
.ind-cb{width:15px;height:15px;border:2px solid var(--b2);border-radius:4px;flex-shrink:0;margin-top:1px;display:flex;align-items:center;justify-content:center;transition:all .12s}
.ind-item.selected .ind-cb{background:var(--gn);border-color:var(--gn)}
.ind-item.selected .ind-cb::after{content:'✓';color:#fff;font-size:9px;font-weight:800}
.ind-info{flex:1}
.ind-name{font-size:12px;font-weight:600;color:var(--tx);line-height:1.3}
.ind-meta{font-size:11px;color:var(--t3);margin-top:2px}
.ind-diana{font-size:11px;color:var(--gn);font-weight:600;margin-top:1px}
.selected-summary{margin-top:8px;padding:7px 10px;background:#E8F5EF;border-radius:6px;font-size:12px;color:var(--gn);display:none;line-height:1.5}
.selected-summary.show{display:block}
/* NIC */
.nb{border:1px solid var(--brd);border-radius:var(--rs);overflow:hidden;margin-bottom:8px}
.nh{background:var(--acl);padding:8px 12px;display:flex;align-items:center;gap:8px}
.nc{font-family:monospace;font-size:11px;font-weight:700;background:var(--ac);color:#fff;padding:2px 7px;border-radius:4px;flex-shrink:0}
.nn{font-size:13px;font-weight:700;color:var(--ac)}
.nb-body{padding:12px;display:flex;flex-direction:column;gap:10px}
.obj{font-size:13px;color:var(--tx);line-height:1.6;background:var(--bg);padding:9px 11px;border-radius:var(--rs);border-left:3px solid var(--ac)}
.obj strong{font-weight:700;color:var(--ac)}
.tw{overflow-x:auto;border-radius:var(--rs);border:1px solid var(--brd)}
table{width:100%;border-collapse:collapse;font-size:12px}
thead tr{background:var(--bg)}
th{padding:7px 10px;text-align:left;font-weight:700;color:var(--t2);font-size:10px;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid var(--brd);white-space:nowrap}
td{padding:7px 10px;color:var(--tx);border-bottom:1px solid var(--brd);vertical-align:top;line-height:1.45}
tr:last-child td{border-bottom:none}
tbody tr:nth-child(even){background:#FAFAF8}
.al{list-style:none}
.al li{display:flex;gap:8px;padding:5px 0;border-bottom:1px solid var(--brd);font-size:13px;color:var(--t2);line-height:1.5}
.al li:last-child{border-bottom:none}
.al li::before{content:'›';color:var(--ac);font-size:14px;flex-shrink:0}
/* GPC CARD */
.gpc-card{background:var(--card);border:1.5px solid var(--amb);border-radius:var(--r);overflow:hidden;box-shadow:0 2px 8px rgba(139,94,0,.1);margin-bottom:12px}
.gpc-header{background:var(--aml);padding:14px 17px}
.gpc-header h3{font-size:14px;font-weight:700;color:var(--tx);line-height:1.3;margin-bottom:4px}
.gpc-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.gpc-badge{font-size:11px;padding:3px 9px;border-radius:99px;font-weight:700}
.gb-clave{background:var(--tx);color:#fff}
.gb-inst{background:var(--amb);color:#4A2800}
.gb-año{background:#fff;color:var(--am);border:1px solid var(--amb)}
.gpc-sec{padding:13px 17px;border-top:1px solid var(--amb)}
.gpc-sec-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--am);margin-bottom:7px;display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.gpc-sec-text{font-size:13px;color:var(--tx);line-height:1.7}
.ev-badge{background:var(--amb);color:#4A2800;padding:2px 7px;border-radius:99px;font-size:11px;font-weight:800}
/* DRUG TABLES */
.drug-section{padding:13px 17px;border-top:1px solid var(--amb)}
.drug-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;display:flex;align-items:center;gap:6px}
.dl-1{color:var(--gn)}
.dl-2{color:var(--am)}
.dtw{overflow-x:auto;border-radius:var(--rs);border:1px solid var(--brd)}
.dt{width:100%;border-collapse:collapse;font-size:12px}
.dt-1 thead tr{background:var(--gnl)}
.dt-1 th{padding:7px 10px;text-align:left;font-weight:700;color:var(--gn);font-size:10px;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid var(--gnb);white-space:nowrap}
.dt-1 td{padding:8px 10px;border-bottom:1px solid #D5EDE4;vertical-align:top;line-height:1.5;color:var(--tx)}
.dt-2 thead tr{background:var(--aml)}
.dt-2 th{padding:7px 10px;text-align:left;font-weight:700;color:var(--am);font-size:10px;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid var(--amb);white-space:nowrap}
.dt-2 td{padding:8px 10px;border-bottom:1px solid #F3E8C8;vertical-align:top;line-height:1.5;color:var(--tx)}
.dt tr:last-child td{border-bottom:none}
.dn{font-weight:700}
.dci{font-size:10px;color:var(--t3);display:block;margin-top:1px}
.mt{font-size:10px;background:var(--gnl);color:var(--gn);padding:2px 6px;border-radius:99px;font-weight:700;display:inline-block;margin-top:2px}
/* GPC CKM */
.gpc-ckm{background:var(--card);border:2px solid var(--ckm);border-radius:var(--r);overflow:hidden;box-shadow:0 2px 12px rgba(26,74,107,.1);margin-bottom:12px}
.gch{background:var(--ckm);padding:14px 17px;display:flex;gap:11px;align-items:flex-start}
.gch h3{font-size:14px;font-weight:700;color:#fff;line-height:1.3}
.gch p{font-size:11px;color:#B8DAF0;margin-top:2px}
.ckm-stage2{display:inline-flex;align-items:center;background:rgba(255,255,255,.18);border-radius:99px;padding:3px 11px;font-size:11px;font-weight:700;color:#fff;margin-top:7px;border:1px solid rgba(255,255,255,.25)}
.gcs{padding:13px 17px;border-top:1px solid var(--ckmb)}
.gcsl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--ckm);margin-bottom:6px;display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.gct{font-size:13px;color:var(--tx);line-height:1.7}
.ckm-ev{background:var(--ckml);color:var(--ckm);padding:2px 7px;border-radius:99px;font-size:11px;font-weight:800;border:1px solid var(--ckmb)}
.dtw-c{overflow-x:auto;border-radius:var(--rs);border:1px solid var(--ckmb);margin-top:8px}
.dt-c{width:100%;border-collapse:collapse;font-size:12px}
.dt-c thead tr{background:var(--ckml)}
.dt-c th{padding:7px 10px;text-align:left;font-weight:700;color:var(--ckm);font-size:10px;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid var(--ckmb);white-space:nowrap}
.dt-c td{padding:8px 10px;border-bottom:1px solid #D0E6F5;vertical-align:top;line-height:1.5;color:var(--tx)}
.dt-c tr:last-child td{border-bottom:none}
/* ALERTS */
.ab{display:flex;gap:8px;padding:10px 13px;border-radius:var(--rs);font-size:13px;line-height:1.6;margin-top:12px}
.ab-w{background:var(--aml);border:1px solid var(--amb);color:var(--am)}
.ab-i{background:var(--acl);border:1px solid #B3CBE8;color:var(--ac)}
.ab-c{background:var(--ckml);border:1px solid var(--ckmb);color:var(--ckm)}
.ai{font-size:14px;flex-shrink:0}
.top-acts{display:flex;gap:7px;justify-content:flex-end;margin-bottom:12px;flex-wrap:wrap}
.foot{text-align:center;padding:16px;font-size:11px;color:var(--t3);border-top:1px solid var(--brd);margin-top:14px;line-height:1.8}
/* PRESCRIPCION ENFERMERIA */
.enf-card{background:var(--card);border:2px solid #2D6A4F;border-radius:var(--r);overflow:hidden;box-shadow:0 2px 12px rgba(45,106,79,.12);margin-bottom:12px}
.enf-header{background:linear-gradient(135deg,#1B4332,#2D6A4F);padding:14px 17px;display:flex;gap:11px;align-items:flex-start}
.enf-header h3{font-size:14px;font-weight:700;color:#fff;line-height:1.3}
.enf-header p{font-size:11px;color:#95D5B2;margin-top:3px;line-height:1.5}
.enf-sec{padding:13px 17px;border-top:1px solid #95D5B2}
.enf-sec-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ml-I{color:#1B4332}
.ml-C{color:#7B3F00}
.ml-ERA{color:#1A3A6B}
.mod-pill{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:800}
.mod-I{background:#D8F3DC;color:#1B4332;border:1px solid #74C69D}
.mod-C{background:#FFF3CD;color:#7B3F00;border:1px solid #FFC107}
.mod-ERA{background:#DBEAFE;color:#1A3A6B;border:1px solid #93C5FD}
.sup-pill{display:inline-flex;align-items:center;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700}
.sup-auto{background:#D8F3DC;color:#1B4332}
.sup-colab{background:#FFF3CD;color:#7B3F00}
.sup-epa{background:#DBEAFE;color:#1A3A6B}
.enf-table{width:100%;border-collapse:collapse;font-size:12px}
.enf-table thead tr{background:#D8F3DC}
.enf-table th{padding:7px 10px;text-align:left;font-weight:700;color:#1B4332;font-size:10px;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid #74C69D;white-space:nowrap}
.enf-table td{padding:8px 10px;border-bottom:1px solid #B7E4C7;vertical-align:top;line-height:1.5;color:var(--tx)}
.enf-table tr:last-child td{border-bottom:none}
.obs-legal{font-size:10px;color:#7B3F00;font-style:italic;margin-top:3px;line-height:1.4}
.legal-box{background:#F0FFF4;border:1px solid #74C69D;border-radius:var(--rs);padding:10px 13px;font-size:12px;color:#1B4332;line-height:1.6;margin:10px 17px 14px}
.legal-box strong{font-weight:700}
.err{display:flex;gap:8px;padding:12px;background:var(--rdl);border:1px solid #E8AAAA;border-radius:var(--rs);color:var(--rd);font-size:13px;line-height:1.6}
@media print{.hdr,.card,.btn-main,.ld,.top-acts{display:none!important}body{background:#fff}.dx-body{max-height:none!important}.wrap{padding:0;max-width:100%}}
@media(max-width:580px){.g2{grid-template-columns:1fr}.g2 .full{grid-column:1}.ind-grid{grid-template-columns:1fr}.prev-grid{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
<header class="hdr">
  <div class="hdr-ic">🩺</div>
  <div>
    <h1>Diagnóstico de Enfermería v3</h1>
    <p>NANDA-I 2024-2026 · NIC 8ª · NOC 7ª · GPC Institucional · CKM 2026</p>
  </div>
  <span class="v3-pill">v3</span>
</header>

<main class="wrap">
  <!-- API KEY -->
  <div class="card">
    <div class="card-title">🔑 API Key de Anthropic</div>
    <div class="fg">
      <label>Clave (sk-ant-...)</label>
      <input type="password" id="apikey" placeholder="sk-ant-api03-..." autocomplete="off">
      <span class="hint">1. Ve a <strong>console.anthropic.com</strong> → API Keys → Create Key ($5 USD gratis ≈ 1,500 diagnósticos)<br>2. Pega la clave → <strong>Guardar</strong></span>
    </div>
    <div class="brow">
      <button class="btn-s p" onclick="saveKey()">💾 Guardar</button>
      <button class="btn-s" onclick="toggleKey()">👁 Mostrar/Ocultar</button>
      <button class="btn-s" onclick="clearKey()">🗑 Borrar</button>
    </div>
    <div id="km" style="margin-top:8px;font-size:12px;display:none"></div>
  </div>

  <!-- FORMULARIO -->
  <div class="card">
    <div class="card-title">📋 Datos del Paciente</div>
    <div class="g2">
      <div class="fg"><label>Edad</label><input type="number" id="age" placeholder="ej. 65" min="0" max="130"></div>
      <div class="fg"><label>Sexo</label>
        <select id="sex"><option value="">Seleccionar...</option><option value="masculino">Masculino</option><option value="femenino">Femenino</option><option value="otro">Otro</option></select>
      </div>
      <div class="fg"><label>Peso (kg)</label><input type="number" id="weight" placeholder="ej. 82" min="1" max="300" step="0.1"></div>
      <div class="fg"><label>Talla (cm)</label><input type="number" id="height" placeholder="ej. 168" min="50" max="220"></div>
      <div class="fg full">
        <label>Signos y síntomas</label>
        <textarea id="symptoms" placeholder="ej. Glucosa 210 mg/dL, TA 148/92 mmHg, SpO2 94%, edema MMII, colesterol 240, disnea leve, cansancio..."></textarea>
        <div class="chips" id="chips"></div>
      </div>
      <div class="fg full">
        <label>Antecedentes / diagnósticos previos</label>
        <input type="text" id="history" placeholder="ej. DM2, HTA, dislipidemia, obesidad G2, ERC estadio 3, neumonía...">
        <span class="hint">💡 Se buscará automáticamente la GPC específica para cada diagnóstico o antecedente. Si hay DM2 + HTA/Obesidad/Dislipidemia se integra también la <strong>Guía CKM 2026</strong>.</span>
      </div>
    </div>
  </div>

  <button class="btn-main" id="btn" onclick="run()">
    ⚡ Generar Diagnósticos NANDA-I + NOC con Indicadores + NIC + GPC Institucional
  </button>

  <div class="ld" id="ld">
    <div class="step" id="s1"><div class="dot" id="d1"></div><span>Generando diagnósticos NANDA-I con términos exactos del libro 2024-2026...</span></div>
    <div class="step" id="s2" style="display:none"><div class="dot" id="d2"></div><span>Buscando GPC institucional con clave y tratamiento 1ª y 2ª elección...</span></div>
    <div class="step" id="s3" style="display:none"><div class="dot" id="d3"></div><span id="s3t">Procesando...</span></div>
    <div class="step" id="s4" style="display:none"><div class="dot" id="d4"></div><span>Calculando tratamiento CKM 2026 con dosis por peso...</span></div>
    <div class="step" id="s5" style="display:none"><div class="dot" id="d5"></div><span>Generando prescripciones autorizadas para Enfermería (Acuerdo DOF · Art. 28 Bis LGS)...</span></div>
  </div>

  <div id="out"></div>
</main>

<script>
// CHIPS
['Dolor','Disnea','Fiebre','Náuseas','Vómito','Inmovilidad','Confusión','Edema','Herida','Incontinencia','Ansiedad','Hipertensión','Glucosa alta','Colesterol','Obesidad','Fatiga','Poliuria','Tos','Cianosis','Diaforesis'].forEach(s=>{
  const b=document.createElement('button');b.className='chip';b.textContent='+ '+s;
  b.onclick=()=>{const t=document.getElementById('symptoms');t.value=t.value?t.value+', '+s.toLowerCase():s.toLowerCase();b.disabled=true};
  document.getElementById('chips').appendChild(b);
});

// API KEY
function saveKey(){const k=document.getElementById('apikey').value.trim();if(!k){msg('Ingresa una clave primero.','#8B2020');return}localStorage.setItem('enf_k3',k);msg('✓ Clave guardada.','#1A6B4A')}
function clearKey(){localStorage.removeItem('enf_k3');document.getElementById('apikey').value='';msg('Clave eliminada.','#8B2020')}
function toggleKey(){const i=document.getElementById('apikey');i.type=i.type==='password'?'text':'password'}
function msg(t,c){const m=document.getElementById('km');m.textContent=t;m.style.color=c;m.style.display='block';setTimeout(()=>m.style.display='none',3000)}
window.addEventListener('load',()=>{const k=localStorage.getItem('enf_k3');if(k)document.getElementById('apikey').value=k});

// STEPS
function stepOn(n,tot){
  for(let i=1;i<=tot;i++){
    const s=document.getElementById('s'+i),d=document.getElementById('d'+i);
    if(!s)continue;
    if(i<n){s.style.display='flex';d.className='dot ok';s.style.opacity='.55'}
    else if(i===n){s.style.display='flex';d.className='dot';s.style.opacity='1'}
    else s.style.display='none';
  }
}

// API CALL
async function apiCall(sysKey,user){
  const key=localStorage.getItem('enf_k3')||document.getElementById('apikey').value.trim();
  if(!key)throw new Error('Ingresa y guarda tu API Key de Anthropic primero (console.anthropic.com).');
  const res=await fetch('/api/diagnose',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,sysKey,user})});
  const data=await res.json();
  if(!res.ok)throw new Error(data.error||'Error del servidor');
  return data.text;
}

// SAFE JSON PARSER
function safeJSON(raw){
  let s=raw.replace(/\`\`\`json|\`\`\`/g,'').trim();
  const st=s.indexOf('{');if(st>0)s=s.slice(st);
  try{return JSON.parse(s)}catch(_){}
  let op=[],inS=false,esc=false,ls=0;
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(esc){esc=false;continue}if(c==='\\\\'){esc=true;continue}
    if(c==='"'){inS=!inS;continue}if(inS)continue;
    if(c==='{'||c==='[')op.push(c==='{'?'}':']');
    if(c==='}'||c===']')op.pop();
    if(op.length<=1&&(c===','||c==='}'||c===']'))ls=i;
  }
  try{return JSON.parse(s.slice(0,ls+1)+[...op].reverse().join(''))}
  catch(e){throw new Error('Respuesta incompleta. Intenta de nuevo.')}
}

function isCKM(h,s){
  const t=(h+' '+s).toLowerCase();
  const k=['dm2','diabetes','dislipidemia','hiperlipidemia','colesterol','triglicerido','obesidad','sobrepeso','hta','hipertension','hipertensión','renal','ckd','albuminuria','cardiovascular'];
  return k.filter(x=>t.includes(x)).length>=2;
}

function tog(i){document.getElementById('db'+i).classList.toggle('o');document.getElementById('cv'+i).classList.toggle('o')}

function toggleInd(el){
  el.classList.toggle('selected');
  const wrap=el.closest('.noc-ind-wrap');
  const summary=wrap.querySelector('.selected-summary');
  const selected=wrap.querySelectorAll('.ind-item.selected');
  if(selected.length>0){
    const names=[...selected].map(s=>s.querySelector('.ind-name').textContent);
    summary.textContent='✓ Indicadores seleccionados ('+selected.length+'): '+names.join(', ');
    summary.classList.add('show');
  } else {
    summary.classList.remove('show');
  }
}

// MAIN RUN
async function run(){
  const symptoms=document.getElementById('symptoms').value.trim();
  if(!symptoms){alert('Ingresa los signos y síntomas del paciente.');return}
  const age=document.getElementById('age').value,sex=document.getElementById('sex').value;
  const weight=document.getElementById('weight').value,height=document.getElementById('height').value;
  const history=document.getElementById('history').value.trim();
  const ckm=isCKM(history,symptoms);
  const totalSteps=ckm?5:4;
  const btn=document.getElementById('btn'),ld=document.getElementById('ld'),out=document.getElementById('out');
  btn.disabled=true;ld.className='ld on';out.className='';out.innerHTML='';
  stepOn(1,totalSteps);
  document.getElementById('s3t').textContent=ckm?'Aplicando Guía CKM 2026 AHA/ACC — estadificación y riesgo PREVENT...':'Completando análisis...';
  const imc=(weight&&height)?(weight/Math.pow(height/100,2)).toFixed(1):null;
  const patient=[
    age?'Edad: '+age+' años':'',sex?'Sexo: '+sex:'',
    weight?'Peso: '+weight+' kg':'Peso: no especificado (usar dosis estándar)',
    height?'Talla: '+height+' cm':'',imc?'IMC: '+imc:'',
    'Signos y síntomas: '+symptoms,
    history?'Antecedentes y diagnósticos previos: '+history:''
  ].filter(Boolean).join('\\n');

  let nanda=null,gpc=null,ckmA=null,ckmB=null,enfRx=null;
  try{
    const r1=await apiCall('NANDA',patient);
    nanda=safeJSON(r1);
    stepOn(2,totalSteps);
    const pad=nanda.padecimiento_principal||symptoms.split(',')[0];
    const r2=await apiCall('GPC','Padecimiento principal: '+pad+'\\n'+patient);
    gpc=safeJSON(r2);
    stepOn(3,totalSteps);
    const useCKM=ckm||(nanda.ckm_aplica===true);
    if(useCKM){
      const r3=await apiCall('CKM_A',patient);
      ckmA=safeJSON(r3);
      stepOn(4,totalSteps);
      const r4=await apiCall('CKM_B',patient);
      ckmB=safeJSON(r4);
    }
    // PASO FINAL: Prescripciones autorizadas para enfermería
    stepOn(useCKM?5:4,totalSteps);
    const r5=await apiCall('ENF_RX','Padecimiento: '+pad+'\n'+patient+'\nDiagnosticos NANDA: '+(nanda.diagnosticos||[]).map(d=>d.nanda_codigo+' '+d.nanda_nombre).join(', '));
    enfRx=safeJSON(r5);
  }catch(e){
    ld.className='ld';btn.disabled=false;
    out.className='on';
    out.innerHTML='<div class="err"><span>⚠️</span><div>'+e.message+'</div></div>';
    return;
  }
  ld.className='ld';btn.disabled=false;
  render(nanda,gpc,ckmA,ckmB,enfRx,{age,sex,weight,height,imc,symptoms,history});
}

function render(nanda,gpc,ckmA,ckmB,enfRx,info){
  const out=document.getElementById('out');
  const dxs=nanda.diagnosticos||[];
  const pb={alta:'b-a',media:'b-m',baja:'b-b'};
  const pl={alta:'⚑ Alta',media:'⚑ Media',baja:'⚑ Baja'};
  let nocCount=0;

  // PATIENT BANNER
  let tags='';
  if(info.age)tags+='<span class="ptag">👤 '+info.age+' años</span>';
  if(info.sex)tags+='<span class="ptag">'+(info.sex==='femenino'?'♀':'♂')+' '+info.sex.charAt(0).toUpperCase()+info.sex.slice(1)+'</span>';
  if(info.weight)tags+='<span class="ptag">⚖️ '+info.weight+' kg</span>';
  if(info.height)tags+='<span class="ptag">📏 '+info.height+' cm</span>';
  if(info.imc){const v=parseFloat(info.imc);const lb=v<18.5?'Bajo peso':v<25?'Normal':v<30?'Sobrepeso':'Obesidad';tags+='<span class="ptag'+(v>=30?' w':'')+'">📊 IMC '+info.imc+' · '+lb+'</span>'}
  if(info.history)tags+='<span class="ptag">📁 '+info.history+'</span>';
  if(ckmA)tags+='<span class="ptag ckm">🫀 CKM 2026</span>';

  let h='<div class="top-acts"><button class="btn-s" onclick="window.print()">🖨️ Imprimir</button><button class="btn-s p" onclick="exportTxt()">📄 Exportar TXT</button></div>';
  h+='<div class="pb"><h3>Resumen Clínico del Paciente</h3>'+tags+'</div>';

  // CKM BANNER
  if(ckmA){
    h+='<div class="ckm-banner">'
     +'<h4>🫀 Síndrome CKM · Guía AHA/ACC/ADA/ASN 2026 '+(ckmA.ckm_estadio?'<span class="ckm-stage">'+ckmA.ckm_estadio+'</span>':'')+'</h4>'
     +(ckmA.ckm_estadio_justificacion?'<p>'+ckmA.ckm_estadio_justificacion+'</p>':'')
     +(ckmA.prevent_riesgo_10a||ckmA.prevent_riesgo_30a?
       '<div class="prev-grid">'
       +(ckmA.prevent_riesgo_10a?'<div class="prev-box"><div class="prev-val">'+ckmA.prevent_riesgo_10a+'</div><div class="prev-lbl">Riesgo PREVENT 10 años</div></div>':'')
       +(ckmA.prevent_riesgo_30a?'<div class="prev-box"><div class="prev-val">'+ckmA.prevent_riesgo_30a+'</div><div class="prev-lbl">Riesgo PREVENT 30 años</div></div>':'')
       +'</div>':'')
     +'</div>';
  }

  // DIAGNÓSTICOS
  h+='<div class="sl">Diagnósticos de Enfermería · NANDA-I 2024-2026 — Términos Oficiales del Libro</div>';
  dxs.forEach((dx,i)=>{
    h+='<div class="dx">'
     +'<div class="dx-top" onclick="tog('+i+')">'
     +'<div style="flex:1"><div class="bgs"><span class="bg b-n">'+(dx.nanda_codigo||'')+'</span><span class="bg '+(pb[dx.prioridad]||'b-m')+'">'+(pl[dx.prioridad]||'')+'</span></div>'
     +'<div class="dx-name">'+(dx.nanda_nombre||'')+'</div>'
     +'<div class="dx-sub">'+(dx.nanda_dominio||'')+' · '+(dx.nanda_clase||'')+'</div></div>'
     +'<div class="chev" id="cv'+i+'">▾</div></div>'
     +'<div class="dx-body" id="db'+i+'"><div class="dx-inner">';

    // DIAGNÓSTICO ESTRUCTURADO (formato oficial)
    h+='<div class="dx-struct">'
     +'<div class="ds-row"><span class="ds-label">Etiqueta</span><span class="ds-val"><strong>'+( dx.nanda_codigo||'')+' '+( dx.nanda_nombre||'')+'</strong></span></div>'
     +(dx.factores_relacionados?.length?'<div class="ds-row"><span class="ds-label">r/c</span><span class="ds-val">'+dx.factores_relacionados.join(' / ')+'</span></div>':'')
     +(dx.caracteristicas_definitorias?.length?'<div class="ds-row"><span class="ds-label">m/p</span><span class="ds-val">'+dx.caracteristicas_definitorias.join(' · ')+'</span></div>':'')
     +'</div>';

    if(dx.justificacion)h+='<div class="jf">'+dx.justificacion+'</div>';

    // NOC CON INDICADORES SELECCIONABLES
    if(dx.noc?.length){
      h+='<div class="sub"><div class="stl c-g">🎯 Resultados NOC · Indicadores Seleccionables</div>';
      dx.noc.forEach(n=>{
        const nid='noc-'+i+'-'+(nocCount++);
        h+='<div class="noc-block">'
         +'<div class="noc-head"><span class="noc-code">'+n.codigo+'</span><span class="noc-name">'+n.nombre+'</span></div>'
         +(n.descripcion_breve?'<div class="noc-desc">'+n.descripcion_breve+'</div>':'')
         +'<div class="noc-ind-wrap">'
         +'<div class="noc-ind-title">Indicadores disponibles <span>Toca para seleccionar los que aplicarás</span></div>'
         +'<div class="ind-grid" id="'+nid+'">';
        if(n.indicadores?.length){
          n.indicadores.forEach(ind=>{
            h+='<div class="ind-item" onclick="toggleInd(this)">'
             +'<div class="ind-cb"></div>'
             +'<div class="ind-info">'
             +'<div class="ind-name">'+(ind.nombre_indicador||'')+'</div>'
             +'<div class="ind-meta">Cód. '+(ind.codigo_indicador||'')+' · '+(ind.escala_medicion||'')+'</div>'
             +(ind.puntuacion_diana?'<div class="ind-diana">Meta: '+ind.puntuacion_diana+'</div>':'')
             +'</div></div>';
          });
        }
        h+='</div><div class="selected-summary"></div></div></div>';
      });
      h+='</div>';
    }

    // NIC
    if(dx.nic?.length){
      h+='<div class="sub"><div class="stl c-a">⚕️ Intervenciones NIC 8ª ed.</div>'
       +dx.nic.map(n=>'<div class="nb">'
         +'<div class="nh"><span class="nc">'+n.codigo+'</span><span class="nn">'+n.nombre+'</span></div>'
         +'<div class="nb-body">'
         +(n.objetivo?'<div class="obj"><strong>🎯 Objetivo:</strong> '+n.objetivo+'</div>':'')
         +(n.indicadores_evaluacion?.length?'<div><div class="stl c-a" style="margin-bottom:6px">📊 Indicadores de evaluación</div><div class="tw"><table><thead><tr><th>Indicador</th><th>Basal</th><th>Meta</th><th>Frecuencia</th></tr></thead><tbody>'+n.indicadores_evaluacion.map(ind=>'<tr><td>'+ind.indicador+'</td><td>'+ind.basal+'</td><td><strong>'+ind.meta+'</strong></td><td>'+ind.frecuencia+'</td></tr>').join('')+'</tbody></table></div></div>':'')
         +(n.actividades?.length?'<div><div class="stl c-m" style="margin-bottom:6px">📝 Actividades de enfermería</div><ul class="al">'+n.actividades.map(a=>'<li>'+a+'</li>').join('')+'</ul></div>':'')
         +'</div></div>').join('')
       +'</div>';
    }

    h+='</div></div></div></div>';
  });

  // GPC INSTITUCIONAL
  if(gpc){
    h+='<div class="sl">📋 Guía de Práctica Clínica Institucional</div>';
    h+='<div class="gpc-card">'
     +'<div class="gpc-header">'
     +'<h3>'+( gpc.gpc_nombre_completo||'Guía de Práctica Clínica')+'</h3>'
     +'<div class="gpc-meta">'
     +(gpc.gpc_clave?'<span class="gpc-badge gb-clave">'+gpc.gpc_clave+'</span>':'')
     +(gpc.gpc_institucion?'<span class="gpc-badge gb-inst">'+gpc.gpc_institucion+'</span>':'')
     +(gpc.gpc_año?'<span class="gpc-badge gb-año">'+gpc.gpc_año+(gpc.gpc_version?' · v'+gpc.gpc_version:'')+'</span>':'')
     +'</div></div>'
     +(gpc.recomendacion_principal?'<div class="gpc-sec"><div class="gpc-sec-lbl">✅ Recomendación principal '+(gpc.nivel_evidencia?'<span class="ev-badge">Evidencia '+gpc.nivel_evidencia+'</span>':'')+'</div><div class="gpc-sec-text">'+gpc.recomendacion_principal+'</div></div>':'')
     +(gpc.punto_buena_practica?'<div class="gpc-sec"><div class="gpc-sec-lbl">⭐ Punto de buena práctica · Enfermería</div><div class="gpc-sec-text">'+gpc.punto_buena_practica+'</div></div>':'');

    // PRIMERA ELECCIÓN
    if(gpc.primera_eleccion?.length){
      h+='<div class="drug-section"><div class="drug-lbl dl-1">💊 Tratamiento de primera elección — según '+( gpc.gpc_clave||'GPC')+'</div>'
       +'<div class="dtw"><table class="dt dt-1"><thead><tr><th>Fármaco / DCI</th><th>Dosis calculada</th><th>Vía</th><th>Frecuencia</th><th>Duración</th><th>Mecanismo</th><th>Contraindicaciones</th><th>Meta</th></tr></thead><tbody>'
       +gpc.primera_eleccion.map(f=>'<tr>'
         +'<td><span class="dn">'+f.nombre+'</span><span class="dci">'+( f.dci||'')+(f.clase_farmacologica?' · '+f.clase_farmacologica:'')+'</span></td>'
         +'<td><strong>'+( f.dosis_calculada_paciente||f.dosis_adulto||'')+'</strong><br><span style="font-size:10px;color:var(--t3)">'+( f.dosis_adulto||'')+'</span></td>'
         +'<td>'+( f.via||'')+'</td><td>'+( f.frecuencia||'')+'</td><td>'+( f.duracion||'')+'</td>'
         +'<td style="font-size:11px">'+( f.mecanismo_accion_breve||'')+'</td>'
         +'<td style="font-size:11px;color:var(--rd)">'+( f.contraindicaciones_principales||'')+'</td>'
         +'<td>'+(f.meta_terapeutica?'<span class="mt">'+f.meta_terapeutica+'</span>':'')+'</td>'
         +'</tr>').join('')
       +'</tbody></table></div></div>';
    }

    // SEGUNDA ELECCIÓN
    if(gpc.segunda_eleccion?.length){
      h+='<div class="drug-section"><div class="drug-lbl dl-2">🔄 Tratamiento de segunda elección / alternativas</div>'
       +'<div class="dtw"><table class="dt dt-2"><thead><tr><th>Fármaco / DCI</th><th>Dosis calculada</th><th>Vía</th><th>Frecuencia</th><th>Duración</th><th>Razón 2ª línea</th><th>Meta</th></tr></thead><tbody>'
       +gpc.segunda_eleccion.map(f=>'<tr>'
         +'<td><span class="dn">'+f.nombre+'</span><span class="dci">'+( f.dci||'')+(f.clase_farmacologica?' · '+f.clase_farmacologica:'')+'</span></td>'
         +'<td><strong>'+( f.dosis_calculada_paciente||f.dosis_adulto||'')+'</strong></td>'
         +'<td>'+( f.via||'')+'</td><td>'+( f.frecuencia||'')+'</td><td>'+( f.duracion||'')+'</td>'
         +'<td style="font-size:11px;color:var(--am)">'+( f.razon_segunda_linea||'')+'</td>'
         +'<td>'+(f.meta_terapeutica?'<span class="mt">'+f.meta_terapeutica+'</span>':'')+'</td>'
         +'</tr>').join('')
       +'</tbody></table></div></div>';
    }

    if(gpc.advertencia_clinica)h+='<div style="padding:0 17px 13px"><div class="ab ab-w"><span class="ai">⚠️</span><span>'+gpc.advertencia_clinica+'</span></div></div>';
    h+='</div>';
  }

  // GPC CKM 2026
  if(ckmA){
    h+='<div class="sl">🫀 Guía CKM 2026 · AHA/ACC/ADA/ASN</div>';
    h+='<div class="gpc-ckm">'
     +'<div class="gch"><div><h3>2026 Guideline — Cardiovascular-Kidney-Metabolic Syndrome</h3>'
     +'<p>AHA / ACC / ADA / ASN · Primera guía mundial del Síndrome CKM</p>'
     +(ckmA.ckm_estadio?'<div class="ckm-stage2">'+ckmA.ckm_estadio+'</div>':'')+'</div></div>'
     +(ckmA.recomendacion?'<div class="gcs"><div class="gcsl">✅ Recomendación CKM 2026 '+(ckmA.nivel_evidencia?'<span class="ckm-ev">Evidencia '+ckmA.nivel_evidencia+'</span>':'')+'</div><div class="gct">'+ckmA.recomendacion+'</div></div>':'')
     +(ckmA.punto_buena_practica?'<div class="gcs"><div class="gcsl">⭐ Buena práctica · Enfermería CKM</div><div class="gct">'+ckmA.punto_buena_practica+'</div></div>':'');

    if(ckmB?.primera_eleccion_ckm?.length){
      h+='<div class="gcs"><div class="gcsl">💊 Primera elección CKM 2026</div>'
       +'<div class="ab ab-c"><span class="ai">🫀</span><span>Terapias cardioprotectoras priorizadas: <strong>SGLT2i</strong> y <strong>GLP-1 RA</strong> de primera línea en DM2+ECV. <strong>RASi</strong> en ERC+HTA. <strong>Estatinas alta intensidad</strong> si ASCVD o riesgo ≥7.5%.</span></div>'
       +'<div class="dtw-c"><table class="dt-c"><thead><tr><th>Fármaco</th><th>Clase</th><th>Dosis calculada</th><th>Vía</th><th>Frecuencia</th><th>Indicación CKM</th><th>Meta</th></tr></thead><tbody>'
       +ckmB.primera_eleccion_ckm.map(f=>'<tr>'
         +'<td><span class="dn">'+f.nombre+'</span><span class="dci">'+( f.dci||'')+'</span></td>'
         +'<td style="font-size:11px;color:var(--ckm);font-weight:700">'+( f.clase_farmacologica||'')+'</td>'
         +'<td><strong>'+( f.dosis_calculada||'')+'</strong><br><span style="font-size:10px;color:var(--t3)">'+( f.observaciones_clinicas||'')+'</span></td>'
         +'<td>'+( f.via||'')+'</td><td>'+( f.frecuencia||'')+'</td>'
         +'<td style="font-size:11px">'+( f.indicacion_ckm||'')+'</td>'
         +'<td>'+(f.meta_terapeutica?'<span class="mt">'+f.meta_terapeutica+'</span>':'')+'</td></tr>').join('')
       +'</tbody></table></div></div>';
    }
    if(ckmB?.segunda_eleccion_ckm?.length){
      h+='<div class="gcs"><div class="gcsl">🔄 Segunda elección CKM 2026</div>'
       +'<div class="dtw-c"><table class="dt-c"><thead><tr><th>Fármaco</th><th>Clase</th><th>Dosis calculada</th><th>Vía</th><th>Frecuencia</th><th>Indicación CKM</th><th>Meta</th></tr></thead><tbody>'
       +ckmB.segunda_eleccion_ckm.map(f=>'<tr>'
         +'<td><span class="dn">'+f.nombre+'</span><span class="dci">'+( f.dci||'')+'</span></td>'
         +'<td style="font-size:11px;color:var(--ckm);font-weight:700">'+( f.clase_farmacologica||'')+'</td>'
         +'<td><strong>'+( f.dosis_calculada||'')+'</strong><br><span style="font-size:10px;color:var(--t3)">'+( f.observaciones_clinicas||'')+'</span></td>'
         +'<td>'+( f.via||'')+'</td><td>'+( f.frecuencia||'')+'</td>'
         +'<td style="font-size:11px">'+( f.indicacion_ckm||'')+'</td>'
         +'<td>'+(f.meta_terapeutica?'<span class="mt">'+f.meta_terapeutica+'</span>':'')+'</td></tr>').join('')
       +'</tbody></table></div></div>';
    }
    if(ckmA.advertencia_clinica)h+='<div style="padding:0 17px 13px"><div class="ab ab-w"><span class="ai">⚠️</span><span>'+ckmA.advertencia_clinica+'</span></div></div>';
    h+='</div>';
  }


  // ── PRESCRIPCIONES AUTORIZADAS ENFERMERÍA ──
  if(enfRx&&enfRx.medicamentos?.length){
    const mods={I:[],C:[],ERA:[]};
    (enfRx.medicamentos||[]).forEach(m=>{
      const k=m.modalidad==='I'?'I':m.modalidad==='C'?'C':'ERA';
      mods[k].push(m);
    });
    h+='<div class="sl">💊 Prescripciones Autorizadas para Enfermería · Acuerdo DOF · Art. 28 Bis LGS</div>';
    h+='<div class="enf-card">'
     +'<div class="enf-header">'
     +'<div>'
     +'<h3>🩺 Medicamentos con Facultad de Prescripción — Enfermería</h3>'
     +'<p>'+( enfRx.base_legal||'Acuerdo por el que se emiten los Lineamientos para prescripción de medicamentos por Licenciados en Enfermería y Pasantes · Capítulo III · Art. 28 Bis LGS')+'</p>'
     +'</div></div>'
     +'<div class="legal-box">'
     +'<strong>Base legal:</strong> Acuerdo DOF — Lineamientos que determinan el procedimiento y criterios para la prescripción de medicamentos por personas Licenciadas en Enfermería y Pasantes en Servicio Social. Capítulo III.<br>'
     +'<strong>Modalidades:</strong> '
     +'<span class="mod-pill mod-I">I · Prescripción Inicial/Autónoma</span> '
     +'<span class="mod-pill mod-C">C · Prescripción Colaborativa</span> '
     +'<span class="mod-pill mod-ERA">ERA/EPA · Rol Ampliado / Práctica Avanzada</span>'
     +'</div>';

    // Tabla por modalidad
    ['I','C','ERA'].forEach(mod=>{
      const items=mods[mod];
      if(!items.length)return;
      const modLabel=mod==='I'?'Modalidad I — Prescripción Inicial / Autónoma':mod==='C'?'Modalidad C — Prescripción Colaborativa':'Modalidad ERA/EPA — Rol Ampliado / Práctica Avanzada';
      const modClass=mod==='I'?'ml-I':mod==='C'?'ml-C':'ml-ERA';
      const pillClass=mod==='I'?'mod-I':mod==='C'?'mod-C':'mod-ERA';
      h+='<div class="enf-sec">'
       +'<div class="enf-sec-lbl '+modClass+'">'
       +'<span class="mod-pill '+pillClass+'">'+mod+'</span>'
       +modLabel
       +'</div>'
       +'<div style="overflow-x:auto;border-radius:var(--rs);border:1px solid #74C69D">'
       +'<table class="enf-table"><thead><tr>'
       +'<th>Medicamento / DCI</th><th>Grupo terapéutico</th><th>Indicación en este caso</th>'
       +'<th>Dosis autorizada</th><th>Vía</th><th>Frecuencia</th><th>Duración</th><th>Supervisión</th>'
       +'</tr></thead><tbody>'
       +items.map(m=>{
         const supClass=m.nivel_supervision==='Autónoma'?'sup-auto':m.nivel_supervision&&m.nivel_supervision.includes('EPA')?'sup-epa':'sup-colab';
         return '<tr>'
           +'<td><strong>'+m.nombre+'</strong><br><span style="font-size:10px;color:var(--t3)">'+( m.dci||'')+'</span></td>'
           +'<td style="font-size:11px">'+( m.grupo_terapeutico||'')+'</td>'
           +'<td style="font-size:12px">'+( m.indicacion_caso||'')+'<div class="obs-legal">'+( m.observacion_legal||'')+'</div></td>'
           +'<td><strong>'+( m.dosis_enfermeria||'')+'</strong></td>'
           +'<td>'+( m.via||'')+'</td>'
           +'<td>'+( m.frecuencia||'')+'</td>'
           +'<td>'+( m.duracion||'')+'</td>'
           +'<td><span class="sup-pill '+supClass+'">'+( m.nivel_supervision||'')+'</span></td>'
           +'</tr>';
       }).join('')
       +'</tbody></table></div></div>';
    });

    h+='<div class="legal-box" style="margin-top:0;border-top:1px solid #74C69D;border-radius:0">'
     +'⚠️ <strong>Aviso legal:</strong> La prescripción de medicamentos por Enfermería debe realizarse con base en el expediente clínico completo, cumplir los lineamientos del Acuerdo DOF vigente y, en Modalidad C, contar con la firma del médico colaborador. La Modalidad ERA/EPA requiere certificación formal en Práctica Avanzada.'
     +'</div>';
    h+='</div>';
  }

    h+='<div class="ab ab-i"><span class="ai">ℹ️</span><span>Diagnósticos construidos con <strong>términos exactos del libro NANDA-I 2024-2026</strong>. NIC 8ª ed. · NOC 7ª ed. GPC vinculada con clave institucional. Tratamiento orientativo — debe ser prescrito por el médico tratante.</span></div>';
  h+='<div class="foot">NANDA-I 2024-2026 · NIC 8ª ed. · NOC 7ª ed. · GPC Institucional · Guía CKM 2026 AHA/ACC/ADA/ASN<br>No sustituye el juicio clínico profesional ni la prescripción médica</div>';

  out.innerHTML=h;out.className='on';
  out.scrollIntoView({behavior:'smooth'});
  window._D={nanda,gpc,ckmA,ckmB,enfRx,info};
}

// EXPORT TXT
function exportTxt(){
  const{nanda,gpc,ckmA,ckmB,enfRx,info}=window._D||{};if(!nanda)return;
  let t='DIAGNÓSTICO DE ENFERMERÍA v3\\n'+'='.repeat(65)+'\\n';
  t+='Fecha: '+new Date().toLocaleDateString('es-MX')+'\\n';
  if(info.age)t+='Edad: '+info.age+' años\\n';
  if(info.sex)t+='Sexo: '+info.sex+'\\n';
  if(info.weight)t+='Peso: '+info.weight+' kg\\n';
  if(info.height)t+='Talla: '+info.height+' cm\\n';
  if(info.imc)t+='IMC: '+info.imc+'\\n';
  if(info.symptoms)t+='Síntomas: '+info.symptoms+'\\n';
  if(info.history)t+='Antecedentes: '+info.history+'\\n\\n';
  (nanda.diagnosticos||[]).forEach((dx,i)=>{
    t+='─'.repeat(65)+'\\nDIAGNÓSTICO '+(i+1)+' · PRIORIDAD '+(dx.prioridad||'').toUpperCase()+'\\n';
    t+='Etiqueta: '+(dx.nanda_codigo||'')+' '+( dx.nanda_nombre||'')+'\\n';
    t+=(dx.nanda_dominio||'')+' · '+(dx.nanda_clase||'')+'\\n';
    if(dx.factores_relacionados?.length)t+='r/c: '+dx.factores_relacionados.join(' / ')+'\\n';
    if(dx.caracteristicas_definitorias?.length)t+='m/p: '+dx.caracteristicas_definitorias.join(' · ')+'\\n';
    if(dx.justificacion)t+='Justificación: '+dx.justificacion+'\\n';
    t+='\\n';
    dx.noc?.forEach(n=>{
      t+='NOC ['+n.codigo+'] '+n.nombre+'\\n';
      n.indicadores?.forEach(ind=>t+='  Indicador ['+( ind.codigo_indicador||'')+'] '+( ind.nombre_indicador||'')+' | Escala: '+(ind.escala_medicion||'')+' | Meta: '+(ind.puntuacion_diana||'')+'\\n');
      t+='\\n';
    });
    dx.nic?.forEach(n=>{
      t+='NIC ['+n.codigo+'] '+n.nombre+'\\n';
      if(n.objetivo)t+='  Objetivo: '+n.objetivo+'\\n';
      n.indicadores_evaluacion?.forEach(ind=>t+='  · '+ind.indicador+' | Basal: '+ind.basal+' → Meta: '+ind.meta+' | '+ind.frecuencia+'\\n');
      n.actividades?.forEach(a=>t+='  • '+a+'\\n');
      t+='\\n';
    });
  });
  if(gpc){
    t+='='.repeat(65)+'\\nGUÍA DE PRÁCTICA CLÍNICA INSTITUCIONAL\\n'+'='.repeat(65)+'\\n';
    t+=gpc.gpc_nombre_completo+'\\n';
    t+='Clave: '+(gpc.gpc_clave||'N/D')+' · '+(gpc.gpc_institucion||'')+' · '+(gpc.gpc_año||'')+'\\n\\n';
    if(gpc.recomendacion_principal)t+='Recomendación (Evidencia '+(gpc.nivel_evidencia||'')+'): '+gpc.recomendacion_principal+'\\n\\n';
    if(gpc.punto_buena_practica)t+='Buena práctica: '+gpc.punto_buena_practica+'\\n\\n';
    if(gpc.primera_eleccion?.length){
      t+='PRIMERA ELECCIÓN:\\n';
      gpc.primera_eleccion.forEach(f=>t+='  • '+f.nombre+' ('+( f.dci||'')+') · '+( f.dosis_calculada_paciente||f.dosis_adulto)+' · '+f.via+' · '+f.frecuencia+' · '+f.duracion+' → Meta: '+(f.meta_terapeutica||'')+'\\n');
    }
    if(gpc.segunda_eleccion?.length){
      t+='\\nSEGUNDA ELECCIÓN:\\n';
      gpc.segunda_eleccion.forEach(f=>t+='  • '+f.nombre+' ('+( f.dci||'')+') · '+( f.dosis_calculada_paciente||f.dosis_adulto)+' · '+f.via+' · '+f.frecuencia+' · '+f.duracion+'\\n    Razón: '+(f.razon_segunda_linea||'')+'\\n');
    }
    if(gpc.advertencia_clinica)t+='\\n⚠️ '+gpc.advertencia_clinica+'\\n';
  }
  if(ckmA){
    t+='\\n'+'='.repeat(65)+'\\nGUÍA CKM 2026 · AHA/ACC/ADA/ASN\\n'+'='.repeat(65)+'\\n';
    t+='Estadio: '+(ckmA.ckm_estadio||'')+' — '+(ckmA.ckm_estadio_justificacion||'')+'\\n';
    t+='Riesgo PREVENT 10a: '+(ckmA.prevent_riesgo_10a||'N/D')+'  30a: '+(ckmA.prevent_riesgo_30a||'N/D')+'\\n\\n';
    if(ckmA.recomendacion)t+='Recomendación ('+( ckmA.nivel_evidencia||'')+'):\\n'+ckmA.recomendacion+'\\n\\n';
    if(ckmA.punto_buena_practica)t+='Buena práctica CKM: '+ckmA.punto_buena_practica+'\\n\\n';
    ckmB?.primera_eleccion_ckm?.forEach(f=>t+='  1ª • '+f.nombre+' ['+( f.clase_farmacologica||'')+'] · '+( f.dosis_calculada||'')+' '+f.via+' '+f.frecuencia+' → '+( f.meta_terapeutica||'')+'\\n');
    ckmB?.segunda_eleccion_ckm?.forEach(f=>t+='  2ª • '+f.nombre+' ['+( f.clase_farmacologica||'')+'] · '+( f.dosis_calculada||'')+' '+f.via+' '+f.frecuencia+'\\n');
    if(ckmA.advertencia_clinica)t+='\\n⚠️ '+ckmA.advertencia_clinica+'\\n';
  }
  if(enfRx&&enfRx.medicamentos?.length){
    t+='\\n'+'='.repeat(65)+'\\nPRESCRIPCIONES AUTORIZADAS PARA ENFERMERÍA\\n'+'='.repeat(65)+'\\n';
    t+=(enfRx.base_legal||'Acuerdo DOF - Art. 28 Bis LGS - Capítulo III')+'\\n\\n';
    const mI=enfRx.medicamentos.filter(m=>m.modalidad==='I');
    const mC=enfRx.medicamentos.filter(m=>m.modalidad==='C');
    const mE=enfRx.medicamentos.filter(m=>m.modalidad!=='I'&&m.modalidad!=='C');
    if(mI.length){t+='MODALIDAD I — Prescripción Inicial/Autónoma:\\n';mI.forEach(m=>t+='  • '+m.nombre+' ('+( m.dci||'')+') · '+m.dosis_enfermeria+' '+m.via+' '+m.frecuencia+' por '+m.duracion+'\\n    '+( m.observacion_legal||'')+'\\n')}
    if(mC.length){t+='\\nMODALIDAD C — Prescripción Colaborativa:\\n';mC.forEach(m=>t+='  • '+m.nombre+' ('+( m.dci||'')+') · '+m.dosis_enfermeria+' '+m.via+' '+m.frecuencia+' por '+m.duracion+'\\n    '+( m.observacion_legal||'')+'\\n')}
    if(mE.length){t+='\\nMODALIDAD ERA/EPA — Rol Ampliado/Práctica Avanzada:\\n';mE.forEach(m=>t+='  • '+m.nombre+' ('+( m.dci||'')+') · '+m.dosis_enfermeria+' '+m.via+' '+m.frecuencia+' por '+m.duracion+'\\n    '+( m.observacion_legal||'')+'\\n')}
  }
  t+='\\n'+'='.repeat(65)+'\\nNANDA-I 2024-2026 · NIC 8ª ed. · NOC 7ª ed.\\nOrientativo — validar con juicio clínico profesional\\n';
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([t],{type:'text/plain;charset=utf-8'}));
  a.download='dx_enfermeria_v3_'+new Date().toISOString().slice(0,10)+'.txt';
  a.click();
}
</script>
</body>
</html>`;

// ══════════════════════════════════════════════════════════════
// SERVIDOR
// ══════════════════════════════════════════════════════════════
const systemMap = {
  'NANDA':   SYS_NANDA,
  'GPC':     SYS_GPC,
  'CKM_A':   SYS_CKM_A,
  'CKM_B':   SYS_CKM_B,
  'ENF_RX':  SYS_ENF_RX
};

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options',  'nosniff');
  res.setHeader('X-Frame-Options',         'SAMEORIGIN');
  res.setHeader('X-XSS-Protection',        '1; mode=block');
  res.setHeader('Referrer-Policy',         'strict-origin-when-cross-origin');

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML);
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('OK');
  }
  if (req.method === 'POST' && req.url === '/api/diagnose') {
    try {
      const { key, sysKey, user } = JSON.parse(await readBody(req));
      if (!key)  return sendJSON(res, 400, { error: 'API key requerida' });
      if (!user) return sendJSON(res, 400, { error: 'Datos del paciente requeridos' });
      const sys = systemMap[sysKey];
      if (!sys)  return sendJSON(res, 400, { error: 'Sistema desconocido: ' + sysKey });
      const text = await callAnthropic(key, sys, user);
      return sendJSON(res, 200, { text });
    } catch(e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }
  sendJSON(res, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║  🩺  Dx Enfermería v3 · NANDA-I · NIC · NOC · GPC · CKM ║');
  console.log('  ║                                                          ║');
  console.log('  ║  ➜  http://localhost:' + PORT + '                             ║');
  console.log('  ╚══════════════════════════════════════════════════════════╝');
  console.log('');
});
