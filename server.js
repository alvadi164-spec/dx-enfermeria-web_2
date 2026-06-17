/**
 * Dx Enfermería · NANDA-I 2024-2026 · NIC 8ª · NOC 7ª · CKM 2026 AHA/ACC
 * Node.js sin dependencias externas
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

// ── prompts ───────────────────────────────────────────────────

// NANDA-I / NIC / NOC
const SYS_NANDA = `Eres experto en NANDA-I 2024-2026, NIC 8a ed 2024 y NOC 7a ed 2024.
Genera los 3 diagnosticos de enfermeria mas prioritarios.
Para cada uno: nanda_codigo, nanda_nombre, nanda_dominio, nanda_clase,
factores_relacionados (array max 4), caracteristicas_definitorias (array max 4),
justificacion (1 oracion), prioridad (alta/media/baja),
noc: 2 items con codigo, nombre, escala,
nic: 2 items con codigo, nombre, objetivo (1 oracion medible con plazo),
  indicadores (array max 4: indicador, basal, meta, frecuencia),
  actividades (array 4 items).
Tambien: padecimiento_principal (3-5 palabras), ckm_aplica true/false.
SOLO JSON valido sin backticks ni texto extra:
{"padecimiento_principal":"...","ckm_aplica":false,"diagnosticos":[{"prioridad":"alta","nanda_codigo":"00xxx","nanda_nombre":"...","nanda_dominio":"...","nanda_clase":"...","factores_relacionados":["..."],"caracteristicas_definitorias":["..."],"justificacion":"...","noc":[{"codigo":"xxxx","nombre":"...","escala":"..."}],"nic":[{"codigo":"xxxx","nombre":"...","objetivo":"...","indicadores":[{"indicador":"...","basal":"...","meta":"...","frecuencia":"..."}],"actividades":["...","...","...","..."]}]}]}`;

// GPC estándar (pacientes sin perfil CKM)
const SYS_GPC_STD = `Eres experto en GPC de enfermeria y medicina basada en evidencia.
Identifica la GPC mas reciente relevante (CENETEC, IMSS, NICE, OMS, AHA u otra).
Proporciona: gpc_nombre, gpc_institucion, gpc_año, recomendacion (2 oraciones max),
nivel_evidencia, punto_buena_practica (2 oraciones max), advertencia_clinica (1 oracion),
farmacos: max 5, cada uno con nombre, linea, indicacion (8 palabras max),
dosis_calculada, via, frecuencia, duracion, observaciones_clinicas (12 palabras max).
SOLO JSON sin backticks:
{"gpc_nombre":"...","gpc_institucion":"...","gpc_año":"...","recomendacion":"...","nivel_evidencia":"...","punto_buena_practica":"...","advertencia_clinica":"...","farmacos":[{"nombre":"...","linea":"...","indicacion":"...","dosis_calculada":"...","via":"...","frecuencia":"...","duracion":"...","observaciones_clinicas":"..."}]}`;

// CKM Parte A — estadificacion, riesgo, recomendaciones (sin farmacos)
const SYS_CKM_A = `Eres experto en la Guia CKM 2026 AHA/ACC/ADA/ASN (Cardiovascular-Kidney-Metabolic Syndrome).
Con base en los datos del paciente determina:
- ckm_estadio: "Estadio 0", "Estadio 1", "Estadio 2", "Estadio 3" o "Estadio 4"
- ckm_estadio_justificacion: 1 oracion explicando el estadio
- prevent_riesgo_10a: riesgo ASCVD+IC+ACV a 10 años segun ecuacion PREVENT (ej: "~18%")
- prevent_riesgo_30a: riesgo a 30 años (ej: "~42%")
- recomendacion: recomendacion principal CKM 2026 con nivel evidencia en 2 oraciones
- nivel_evidencia: "A", "B-R", "B-NR" o "C"
- punto_buena_practica: punto especifico de enfermeria para CKM en 2 oraciones
- advertencia_clinica: 1 oracion de advertencia importante
SOLO JSON sin backticks:
{"ckm_estadio":"...","ckm_estadio_justificacion":"...","prevent_riesgo_10a":"...","prevent_riesgo_30a":"...","recomendacion":"...","nivel_evidencia":"...","punto_buena_practica":"...","advertencia_clinica":"..."}`;

// CKM Parte B — solo farmacos cardioprotectores
const SYS_CKM_B = `Eres experto en la Guia CKM 2026 AHA/ACC/ADA/ASN.
Genera el tratamiento farmacologico cardioprotector para el paciente. Maximo 6 farmacos priorizados por la guia CKM 2026.
Orden de prioridad: 1) SGLT2i si DM2+ECV o DM2+ERC (empagliflozina 10mg o dapagliflozina 10mg),
2) GLP-1 RA si obesidad+DM2+riesgo CV (semaglutida SC o liraglutida),
3) RASi (enalapril/losartan) si ERC+HTA+albuminuria,
4) Estatina alta intensidad si ASCVD o riesgo >7.5% (rosuvastatina 20-40mg o atorvastatina 40-80mg),
5) nsMRA finerenona si ERC+DM2+albuminuria persistente,
6) Antihipertensivo adicional si TA no controlada (amlodipino o clortalidona).
Para cada farmaco: nombre, clase_farmacologica (sigla corta: SGLT2i/GLP-1RA/RASi/estatina/nsMRA/CCB/tiazida),
linea (primera/segunda/alternativa), indicacion_ckm (razon segun CKM 2026 en 8 palabras max),
dosis_calculada (con calculo si hay peso: ej "10mg fijo"), via, frecuencia, duracion,
observaciones_clinicas (12 palabras max), meta_terapeutica (valor objetivo corto: ej "HbA1c <7%").
SOLO JSON sin backticks:
{"farmacos":[{"nombre":"...","clase_farmacologica":"...","linea":"...","indicacion_ckm":"...","dosis_calculada":"...","via":"...","frecuencia":"...","duracion":"...","observaciones_clinicas":"...","meta_terapeutica":"..."}]}`;

// ── detección CKM ─────────────────────────────────────────────
function isCKMPatient(history, symptoms) {
  const t = (history + ' ' + symptoms).toLowerCase();
  const keys = ['dm2','diabetes','dislipidemia','hiperlipidemia','colesterol',
    'triglicerido','obesidad','sobrepeso','hta','hipertension','hipertensión',
    'renal','ckd','albuminuria','cardiovascular'];
  return keys.filter(k => t.includes(k)).length >= 2;
}

// ── HTML de la aplicación ─────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dx Enfermería · NANDA-I · NIC · NOC · CKM 2026</title>
<style>
:root{
  --bg:#F5F3EE;--card:#fff;--brd:#E2DDD6;--b2:#CEC8BF;
  --tx:#1A1714;--t2:#5C5650;--t3:#9C9590;
  --ac:#2D5A8E;--acl:#EBF0F8;
  --gn:#1A6B4A;--gnl:#E6F4EE;
  --am:#8B5E00;--aml:#FDF3DC;--amb:#E8C96A;
  --rd:#8B2020;--rdl:#FAEAEA;
  --pu:#4A2D8B;--pul:#EDE8F8;
  --ckm:#1A4A6B;--ckml:#E3EEF8;--ckmb:#7AAFD4;
  --r:12px;--rs:8px;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--tx);min-height:100vh}
/* HEADER */
.hdr{background:var(--tx);padding:13px 18px;display:flex;align-items:center;gap:11px;position:sticky;top:0;z-index:50;box-shadow:0 2px 8px rgba(0,0,0,.2)}
.hdr-ic{width:34px;height:34px;background:var(--ac);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0}
.hdr h1{font-size:15px;color:#fff;font-weight:700;line-height:1.2}
.hdr p{font-size:10px;color:#9C9590;letter-spacing:.04em}
.ckm-pill{background:var(--ckm);color:#fff;font-size:10px;font-weight:700;padding:3px 9px;border-radius:99px;margin-left:auto;white-space:nowrap;border:1px solid var(--ckmb)}
/* MAIN */
.wrap{max-width:820px;margin:0 auto;padding:18px 15px 80px}
/* CARD */
.card{background:var(--card);border:1px solid var(--brd);border-radius:var(--r);padding:18px;margin-bottom:15px;box-shadow:0 1px 4px rgba(0,0,0,.05)}
.card-title{font-size:14px;font-weight:700;color:var(--t2);margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--brd);display:flex;align-items:center;gap:7px}
/* FORM */
.g2{display:grid;grid-template-columns:1fr 1fr;gap:11px}
.g2 .full{grid-column:1/-1}
.fg{display:flex;flex-direction:column;gap:5px}
.fg label{font-size:11px;font-weight:700;color:var(--t2);letter-spacing:.05em;text-transform:uppercase}
.fg input,.fg select,.fg textarea{border:1.5px solid var(--brd);border-radius:var(--rs);padding:9px 12px;font-size:14px;font-family:inherit;color:var(--tx);background:var(--bg);width:100%;transition:border-color .15s}
.fg input:focus,.fg select:focus,.fg textarea:focus{outline:none;border-color:var(--ac);background:#fff}
.fg textarea{resize:vertical;min-height:90px;line-height:1.55}
.hint{font-size:11px;color:var(--t3);margin-top:3px;line-height:1.5}
/* CHIPS */
.chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
.chip{font-size:11px;padding:3px 8px;border-radius:99px;border:1px solid var(--b2);color:var(--t2);background:var(--bg);cursor:pointer;transition:all .12s;font-family:inherit}
.chip:hover{background:var(--acl);border-color:var(--ac);color:var(--ac)}
.chip:disabled{opacity:.35;cursor:default}
/* BUTTONS */
.btn-main{width:100%;background:var(--ac);color:#fff;border:none;border-radius:var(--rs);padding:13px 18px;font-size:15px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:all .18s;font-family:inherit}
.btn-main:hover{background:#1e3f66;transform:translateY(-1px);box-shadow:0 4px 18px rgba(0,0,0,.12)}
.btn-main:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}
.btn-s{font-size:12px;font-weight:600;padding:6px 12px;border-radius:var(--rs);border:1.5px solid var(--b2);background:var(--card);color:var(--t2);cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:5px;transition:all .12s}
.btn-s:hover{border-color:var(--ac);color:var(--ac)}
.btn-s.p{background:var(--ac);color:#fff;border-color:var(--ac)}
.btn-s.p:hover{background:#1e3f66}
.brow{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
/* LOADING */
.ld{display:none;padding:14px 0}
.ld.on{display:block}
.step{display:flex;align-items:center;gap:10px;padding:7px 0;font-size:13px;color:var(--t2)}
.dot{width:17px;height:17px;border-radius:50%;border:2px solid var(--b2);border-top-color:var(--ac);animation:spin .75s linear infinite;flex-shrink:0}
.dot.ok{animation:none;background:var(--gn);border-color:var(--gn);position:relative}
.dot.ok::after{content:'✓';color:#fff;font-size:10px;font-weight:800;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}
@keyframes spin{to{transform:rotate(360deg)}}
/* RESULTS */
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
.dx-body.o{max-height:9000px}
.dx-inner{padding:16px;display:flex;flex-direction:column;gap:16px}
.jf{background:var(--bg);border-left:3px solid var(--ac);padding:10px 13px;border-radius:0 var(--rs) var(--rs) 0;font-size:13px;color:var(--t2);line-height:1.65}
.sub{display:flex;flex-direction:column;gap:7px}
.stl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;display:flex;align-items:center;gap:5px}
.c-p{color:var(--pu)}.c-g{color:var(--gn)}.c-a{color:var(--ac)}.c-m{color:var(--t3)}.c-ckm{color:var(--ckm)}
.tags{display:flex;flex-wrap:wrap;gap:5px}
.tag{font-size:12px;padding:3px 9px;border-radius:99px;border:1px solid var(--brd);color:var(--t2);background:var(--bg)}
.t-g{background:var(--gnl);color:var(--gn);border-color:#A8D9C4}
.t-a{background:var(--acl);color:var(--ac);border-color:#B3CBE8}
.t-p{background:var(--pul);color:var(--pu);border-color:#C2B5E8}
/* NIC BLOCK */
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
/* GPC STANDARD */
.gpc{background:var(--card);border:1px solid var(--amb);border-radius:var(--r);overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04);margin-bottom:12px}
.gh{background:var(--aml);padding:13px 16px;display:flex;gap:10px;align-items:flex-start}
.gi{font-size:20px;flex-shrink:0}
.gh h3{font-size:14px;font-weight:700;color:var(--tx);line-height:1.3}
.gh p{font-size:11px;color:var(--am);margin-top:2px;font-weight:600}
.gs{padding:13px 16px;border-top:1px solid var(--amb)}
.gsl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--am);margin-bottom:6px;display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.gt{font-size:13px;color:var(--tx);line-height:1.7}
.ev{background:var(--amb);color:#4A2800;padding:2px 7px;border-radius:99px;font-size:11px;font-weight:800}
/* GPC CKM */
.gpc-ckm{background:var(--card);border:2px solid var(--ckm);border-radius:var(--r);overflow:hidden;box-shadow:0 2px 12px rgba(26,74,107,.1);margin-bottom:12px}
.gch{background:var(--ckm);padding:14px 17px;display:flex;gap:11px;align-items:flex-start}
.gch-ic{font-size:20px;flex-shrink:0}
.gch h3{font-size:14px;font-weight:700;color:#fff;line-height:1.3}
.gch p{font-size:11px;color:#B8DAF0;margin-top:2px}
.ckm-stage2{display:inline-flex;align-items:center;background:rgba(255,255,255,.18);border-radius:99px;padding:3px 11px;font-size:11px;font-weight:700;color:#fff;margin-top:7px;border:1px solid rgba(255,255,255,.25)}
.gcs{padding:13px 17px;border-top:1px solid var(--ckmb)}
.gcsl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--ckm);margin-bottom:6px;display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.gct{font-size:13px;color:var(--tx);line-height:1.7}
.ckm-ev{background:var(--ckml);color:var(--ckm);padding:2px 7px;border-radius:99px;font-size:11px;font-weight:800;border:1px solid var(--ckmb)}
/* DRUG TABLES */
.dtw{overflow-x:auto;border-radius:var(--rs);margin-top:8px}
.dtw-s{border:1px solid var(--amb)}
.dtw-c{border:1px solid var(--ckmb)}
.dt{width:100%;border-collapse:collapse;font-size:12px}
.dt-s thead tr{background:var(--aml)}
.dt-s th{padding:7px 10px;text-align:left;font-weight:700;color:var(--am);font-size:10px;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid var(--amb);white-space:nowrap}
.dt-s td{padding:8px 10px;border-bottom:1px solid #F3E8C8;vertical-align:top;line-height:1.45;color:var(--tx)}
.dt-c thead tr{background:var(--ckml)}
.dt-c th{padding:7px 10px;text-align:left;font-weight:700;color:var(--ckm);font-size:10px;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid var(--ckmb);white-space:nowrap}
.dt-c td{padding:8px 10px;border-bottom:1px solid #D0E6F5;vertical-align:top;line-height:1.45;color:var(--tx)}
.dt tr:last-child td{border-bottom:none}
.dn{font-weight:700}
.dl{font-size:10px;color:var(--am);font-weight:700;display:block;margin-top:1px}
.dl-c{font-size:10px;color:var(--ckm);font-weight:700;display:block;margin-top:1px}
.mt{font-size:10px;background:var(--gnl);color:var(--gn);padding:2px 6px;border-radius:99px;font-weight:700;display:inline-block;margin-top:2px}
/* ALERTS */
.ab{display:flex;gap:8px;padding:10px 13px;border-radius:var(--rs);font-size:13px;line-height:1.6;margin-top:12px}
.ab-w{background:var(--aml);border:1px solid var(--amb);color:var(--am)}
.ab-i{background:var(--acl);border:1px solid #B3CBE8;color:var(--ac)}
.ab-c{background:var(--ckml);border:1px solid var(--ckmb);color:var(--ckm)}
.ab-e{background:var(--rdl);border:1px solid #E8AAAA;color:var(--rd)}
.ai{font-size:14px;flex-shrink:0}
.top-acts{display:flex;gap:7px;justify-content:flex-end;margin-bottom:12px;flex-wrap:wrap}
.foot{text-align:center;padding:16px;font-size:11px;color:var(--t3);border-top:1px solid var(--brd);margin-top:14px;line-height:1.8}
.err{display:flex;gap:8px;padding:12px;background:var(--rdl);border:1px solid #E8AAAA;border-radius:var(--rs);color:var(--rd);font-size:13px;line-height:1.6}
@media print{.hdr,.card,.btn-main,.ld,.top-acts{display:none!important}body{background:#fff}.dx-body{max-height:none!important}.wrap{padding:0;max-width:100%}}
@media(max-width:560px){.g2{grid-template-columns:1fr}.g2 .full{grid-column:1}.prev-grid{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
<header class="hdr">
  <div class="hdr-ic">🩺</div>
  <div>
    <h1>Diagnóstico de Enfermería</h1>
    <p>NANDA-I 2024-2026 · NIC 8ª ed. · NOC 7ª ed.</p>
  </div>
  <span class="ckm-pill">🫀 CKM 2026 AHA/ACC</span>
</header>

<main class="wrap">

  <!-- API KEY -->
  <div class="card">
    <div class="card-title">🔑 API Key de Anthropic</div>
    <div class="fg">
      <label>Clave (sk-ant-...)</label>
      <input type="password" id="apikey" placeholder="sk-ant-api03-..." autocomplete="off">
      <span class="hint">
        1. Ve a <strong>console.anthropic.com</strong> → API Keys → Create Key (incluye $5 USD gratis ≈ 1,500 diagnósticos)<br>
        2. Pega la clave aquí → <strong>Guardar</strong>
      </span>
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
        <select id="sex">
          <option value="">Seleccionar...</option>
          <option value="masculino">Masculino</option>
          <option value="femenino">Femenino</option>
          <option value="otro">Otro</option>
        </select>
      </div>
      <div class="fg"><label>Peso (kg)</label><input type="number" id="weight" placeholder="ej. 92" min="1" max="300" step="0.1"></div>
      <div class="fg"><label>Talla (cm)</label><input type="number" id="height" placeholder="ej. 168" min="50" max="220"></div>
      <div class="fg full">
        <label>Signos y síntomas</label>
        <textarea id="symptoms" placeholder="ej. Glucosa 210 mg/dL, TA 148/92 mmHg, SpO2 94%, edema MMII, colesterol 240 mg/dL, cansancio..."></textarea>
        <div class="chips" id="chips"></div>
      </div>
      <div class="fg full">
        <label>Antecedentes / contexto clínico</label>
        <input type="text" id="history" placeholder="ej. DM2, HTA, dislipidemia, obesidad G2, ERC estadio 3...">
        <span class="hint">💡 Con DM2 + HTA/Obesidad/Dislipidemia se aplica automáticamente la <strong>Guía CKM 2026 AHA/ACC/ADA/ASN</strong></span>
      </div>
    </div>
  </div>

  <button class="btn-main" id="btn" onclick="run()">
    ⚡ Generar Diagnósticos NANDA + NIC con Indicadores + GPC / CKM 2026
  </button>

  <div class="ld" id="ld">
    <div class="step" id="s1"><div class="dot" id="d1"></div><span>Analizando con NANDA-I 2024-2026, NIC 8ª ed., NOC 7ª ed....</span></div>
    <div class="step" id="s2" style="display:none"><div class="dot" id="d2"></div><span id="s2t">Generando NIC con objetivos e indicadores...</span></div>
    <div class="step" id="s3" style="display:none"><div class="dot" id="d3"></div><span id="s3t">Buscando GPC vigente...</span></div>
    <div class="step" id="s4" style="display:none"><div class="dot" id="d4"></div><span>Calculando tratamiento farmacológico por peso...</span></div>
  </div>

  <div id="out"></div>
</main>

<script>
['Dolor','Disnea','Fiebre','Náuseas','Vómito','Inmovilidad','Confusión','Edema','Herida','Incontinencia','Ansiedad','Hipertensión','Glucosa alta','Colesterol alto','Obesidad','Fatiga','Poliuria','Polidipsia'].forEach(s=>{
  const b=document.createElement('button');b.className='chip';b.textContent='+ '+s;
  b.onclick=()=>{const t=document.getElementById('symptoms');t.value=t.value?t.value+', '+s.toLowerCase():s.toLowerCase();b.disabled=true};
  document.getElementById('chips').appendChild(b);
});

function saveKey(){const k=document.getElementById('apikey').value.trim();if(!k){msg('Ingresa una clave primero.','var(--rd)');return}localStorage.setItem('enf_k',k);msg('✓ Clave guardada.','var(--gn)')}
function clearKey(){localStorage.removeItem('enf_k');document.getElementById('apikey').value='';msg('Clave eliminada.','var(--rd)')}
function toggleKey(){const i=document.getElementById('apikey');i.type=i.type==='password'?'text':'password'}
function msg(t,c){const m=document.getElementById('km');m.textContent=t;m.style.color=c;m.style.display='block';setTimeout(()=>m.style.display='none',3000)}
window.addEventListener('load',()=>{const k=localStorage.getItem('enf_k');if(k)document.getElementById('apikey').value=k});

function stepOn(n,total){
  for(let i=1;i<=total;i++){
    const s=document.getElementById('s'+i),d=document.getElementById('d'+i);
    if(!s)continue;
    if(i<n){s.style.display='flex';d.className='dot ok';s.style.opacity='.6'}
    else if(i===n){s.style.display='flex';d.className='dot';s.style.opacity='1'}
    else s.style.display='none';
  }
}

async function apiCall(sysKey,user){
  const key=localStorage.getItem('enf_k')||document.getElementById('apikey').value.trim();
  if(!key)throw new Error('Ingresa y guarda tu API Key de Anthropic primero (console.anthropic.com).');
  const res=await fetch('/api/diagnose',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,sysKey,user})});
  const data=await res.json();
  if(!res.ok)throw new Error(data.error||'Error del servidor');
  return data.text;
}

function safeJSON(raw){
  let s=raw.replace(/\`\`\`json|\`\`\`/g,'').trim();
  const st=s.indexOf('{');if(st>0)s=s.slice(st);
  try{return JSON.parse(s)}catch(_){}
  // Reparar JSON truncado cerrando llaves/corchetes
  let op=[],inS=false,esc=false,ls=0;
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(esc){esc=false;continue}
    if(c==='\\\\'){esc=true;continue}
    if(c==='"'){inS=!inS;continue}
    if(inS)continue;
    if(c==='{'||c==='[')op.push(c==='{'?'}':']');
    if(c==='}'||c===']')op.pop();
    if(op.length<=1&&(c===','||c==='}'||c===']'))ls=i;
  }
  try{return JSON.parse(s.slice(0,ls+1)+[...op].reverse().join(''))}
  catch(e){throw new Error('Respuesta incompleta de la API. Intenta de nuevo.')}
}

function isCKM(h,s){
  const t=(h+' '+s).toLowerCase();
  const k=['dm2','diabetes','dislipidemia','hiperlipidemia','colesterol','triglicerido','obesidad','sobrepeso','hta','hipertension','hipertensión','renal','ckd','albuminuria','cardiovascular'];
  return k.filter(x=>t.includes(x)).length>=2;
}

function tog(i){document.getElementById('db'+i).classList.toggle('o');document.getElementById('cv'+i).classList.toggle('o')}

async function run(){
  const symptoms=document.getElementById('symptoms').value.trim();
  if(!symptoms){alert('Ingresa los signos y síntomas del paciente.');return}
  const age=document.getElementById('age').value,sex=document.getElementById('sex').value;
  const weight=document.getElementById('weight').value,height=document.getElementById('height').value;
  const history=document.getElementById('history').value.trim();
  const ckm=isCKM(history,symptoms);
  const totalSteps=ckm?4:3;
  const btn=document.getElementById('btn'),ld=document.getElementById('ld'),out=document.getElementById('out');
  btn.disabled=true;ld.className='ld on';out.className='';out.innerHTML='';
  stepOn(1,totalSteps);
  document.getElementById('s3t').textContent=ckm?'Aplicando Guía CKM 2026 AHA/ACC — estadificación y riesgo...':'Buscando GPC vigente y recomendaciones...';
  const imc=(weight&&height)?(weight/Math.pow(height/100,2)).toFixed(1):null;
  const patient=[
    age?'Edad: '+age+' años':'',sex?'Sexo: '+sex:'',
    weight?'Peso: '+weight+' kg':'Peso: no especificado',
    height?'Talla: '+height+' cm':'',imc?'IMC: '+imc:'',
    'Signos y síntomas: '+symptoms,
    history?'Antecedentes: '+history:''
  ].filter(Boolean).join('\\n');

  let nanda=null,gpcBase=null,ckmB=null;
  try{
    // PASO 1: NANDA / NIC / NOC
    const r1=await apiCall('NANDA',patient);
    nanda=safeJSON(r1);
    stepOn(2,totalSteps);
    await new Promise(r=>setTimeout(r,150));
    stepOn(3,totalSteps);

    const pad=nanda.padecimiento_principal||symptoms.split(',')[0];
    const useCKM=ckm||(nanda.ckm_aplica===true);

    if(useCKM){
      // PASO 3: CKM Parte A — estadificacion + recomendaciones
      const r2=await apiCall('CKM_A','Padecimiento: '+pad+'\\n'+patient);
      gpcBase=safeJSON(r2);
      gpcBase._ckm=true;
      stepOn(4,totalSteps);
      // PASO 4: CKM Parte B — solo farmacos
      const r3=await apiCall('CKM_B','Padecimiento: '+pad+'\\n'+patient);
      const fb=safeJSON(r3);
      gpcBase.farmacos=fb.farmacos||[];
    } else {
      // GPC estandar
      const r2=await apiCall('GPC_STD','Padecimiento: '+pad+'\\n'+patient);
      gpcBase=safeJSON(r2);
      gpcBase._ckm=false;
    }
  }catch(e){
    ld.className='ld';btn.disabled=false;
    out.className='on';
    out.innerHTML='<div class="err"><span>⚠️</span><div>'+e.message+'</div></div>';
    return;
  }
  ld.className='ld';btn.disabled=false;
  render(nanda,gpcBase,{age,sex,weight,height,imc,symptoms,history});
}

function render(nanda,gpc,info){
  const out=document.getElementById('out');
  const dxs=nanda.diagnosticos||[];
  const isCKMGpc=gpc&&gpc._ckm;
  const pb={alta:'b-a',media:'b-m',baja:'b-b'};
  const pl={alta:'⚑ Alta',media:'⚑ Media',baja:'⚑ Baja'};

  // Patient banner
  let tags='';
  if(info.age)tags+='<span class="ptag">👤 '+info.age+' años</span>';
  if(info.sex)tags+='<span class="ptag">'+(info.sex==='femenino'?'♀':'♂')+' '+info.sex.charAt(0).toUpperCase()+info.sex.slice(1)+'</span>';
  if(info.weight)tags+='<span class="ptag">⚖️ '+info.weight+' kg</span>';
  if(info.height)tags+='<span class="ptag">📏 '+info.height+' cm</span>';
  if(info.imc){const v=parseFloat(info.imc);const lb=v<18.5?'Bajo peso':v<25?'Normal':v<30?'Sobrepeso':'Obesidad';tags+='<span class="ptag'+(v>=30?' w':'')+'">📊 IMC '+info.imc+' · '+lb+'</span>'}
  if(info.history)tags+='<span class="ptag">📁 '+info.history+'</span>';
  if(isCKMGpc)tags+='<span class="ptag ckm">🫀 CKM 2026</span>';

  let h='<div class="top-acts"><button class="btn-s" onclick="window.print()">🖨️ Imprimir</button><button class="btn-s p" onclick="exportTxt()">📄 Exportar TXT</button></div>';
  h+='<div class="pb"><h3>Resumen Clínico del Paciente</h3>'+tags+'</div>';

  // CKM BANNER
  if(isCKMGpc&&gpc.ckm_estadio){
    h+='<div class="ckm-banner">'
     +'<h4>🫀 Síndrome CKM · Guía AHA/ACC/ADA/ASN 2026 <span class="ckm-stage">'+gpc.ckm_estadio+'</span></h4>'
     +(gpc.ckm_estadio_justificacion?'<p>'+gpc.ckm_estadio_justificacion+'</p>':'')
     +(gpc.prevent_riesgo_10a||gpc.prevent_riesgo_30a?
       '<div class="prev-grid">'
       +(gpc.prevent_riesgo_10a?'<div class="prev-box"><div class="prev-val">'+gpc.prevent_riesgo_10a+'</div><div class="prev-lbl">Riesgo PREVENT 10 años</div></div>':'')
       +(gpc.prevent_riesgo_30a?'<div class="prev-box"><div class="prev-val">'+gpc.prevent_riesgo_30a+'</div><div class="prev-lbl">Riesgo PREVENT 30 años</div></div>':'')
       +'</div>':'')
     +'</div>';
  }

  // DIAGNÓSTICOS
  h+='<div class="sl">Diagnósticos de Enfermería · NANDA-I 2024-2026</div>';
  dxs.forEach((dx,i)=>{
    h+='<div class="dx">'
     +'<div class="dx-top" onclick="tog('+i+')">'
     +'<div style="flex:1"><div class="bgs"><span class="bg b-n">'+(dx.nanda_codigo||'NANDA')+'</span>'
     +'<span class="bg '+(pb[dx.prioridad]||'b-m')+'">'+(pl[dx.prioridad]||'')+'</span></div>'
     +'<div class="dx-name">'+(dx.nanda_nombre||'Diagnóstico')+'</div>'
     +'<div class="dx-sub">'+(dx.nanda_dominio||'')+' · '+(dx.nanda_clase||'')+'</div></div>'
     +'<div class="chev" id="cv'+i+'">▾</div></div>'
     +'<div class="dx-body" id="db'+i+'"><div class="dx-inner">'
     +(dx.justificacion?'<div class="jf">'+dx.justificacion+'</div>':'')
     +(dx.factores_relacionados?.length?'<div class="sub"><div class="stl c-m">🔗 Factores relacionados (r/c)</div><div class="tags">'+dx.factores_relacionados.map(f=>'<span class="tag t-p">'+f+'</span>').join('')+'</div></div>':'')
     +(dx.caracteristicas_definitorias?.length?'<div class="sub"><div class="stl c-m">👁 Características definitorias (m/p)</div><div class="tags">'+dx.caracteristicas_definitorias.map(c=>'<span class="tag">'+c+'</span>').join('')+'</div></div>':'')
     +(dx.noc?.length?'<div class="sub"><div class="stl c-g">🎯 Resultados NOC</div><div class="tags">'+dx.noc.map(n=>'<span class="tag t-g">['+n.codigo+'] '+n.nombre+' · '+(n.escala||'')+'</span>').join('')+'</div></div>':'')
     +(dx.nic?.length?'<div class="sub"><div class="stl c-a">⚕️ Intervenciones NIC</div>'
       +dx.nic.map(n=>'<div class="nb"><div class="nh"><span class="nc">'+n.codigo+'</span><span class="nn">'+n.nombre+'</span></div>'
         +'<div class="nb-body">'
         +(n.objetivo?'<div class="obj"><strong>🎯 Objetivo:</strong> '+n.objetivo+'</div>':'')
         +(n.indicadores?.length?'<div><div class="stl c-a" style="margin-bottom:6px">📊 Indicadores</div><div class="tw"><table><thead><tr><th>Indicador</th><th>Basal</th><th>Meta</th><th>Frecuencia</th></tr></thead><tbody>'+n.indicadores.map(ind=>'<tr><td>'+ind.indicador+'</td><td>'+ind.basal+'</td><td><strong>'+ind.meta+'</strong></td><td>'+ind.frecuencia+'</td></tr>').join('')+'</tbody></table></div></div>':'')
         +(n.actividades?.length?'<div><div class="stl c-m" style="margin-bottom:6px">📝 Actividades</div><ul class="al">'+n.actividades.map(a=>'<li>'+a+'</li>').join('')+'</ul></div>':'')
         +'</div></div>').join('')
       +'</div>':'')
     +'</div></div></div></div>';
  });

  // GPC
  h+='<div class="sl">'+(isCKMGpc?'🫀 Guía CKM 2026 · AHA/ACC/ADA/ASN':'📖 Guía de Práctica Clínica')+'</div>';

  if(gpc&&isCKMGpc){
    h+='<div class="gpc-ckm">'
     +'<div class="gch"><div class="gch-ic">🫀</div><div>'
     +'<h3>Guía CKM 2026 · AHA/ACC/ADA/ASN</h3>'
     +'<p>Primera guía mundial del Síndrome Cardiovascular-Renal-Metabólico</p>'
     +(gpc.ckm_estadio?'<div class="ckm-stage2">'+gpc.ckm_estadio+'</div>':'')
     +'</div></div>'
     +(gpc.recomendacion?'<div class="gcs"><div class="gcsl">✅ Recomendación '+(gpc.nivel_evidencia&&gpc.nivel_evidencia!=='N/A'?'<span class="ckm-ev">Evidencia '+gpc.nivel_evidencia+'</span>':'')+'</div><div class="gct">'+gpc.recomendacion+'</div></div>':'')
     +(gpc.punto_buena_practica?'<div class="gcs"><div class="gcsl">⭐ Buena práctica · Enfermería CKM</div><div class="gct">'+gpc.punto_buena_practica+'</div></div>':'')
     +(gpc.farmacos?.length?
       '<div class="gcs"><div class="gcsl">💊 Tratamiento cardioprotector · CKM 2026</div>'
       +'<div class="ab ab-c"><span class="ai">🫀</span><span>Terapias priorizadas por CKM 2026: <strong>SGLT2i</strong> y <strong>GLP-1 RA</strong> de primera línea en DM2 con riesgo CV. <strong>RASi</strong> en ERC+HTA. <strong>Estatinas alta intensidad</strong> si ASCVD o riesgo ≥7.5%.</span></div>'
       +'<div class="dtw dtw-c"><table class="dt dt-c"><thead><tr><th>Fármaco</th><th>Clase</th><th>Dosis calculada</th><th>Vía</th><th>Frecuencia</th><th>Duración</th><th>Indicación CKM</th><th>Meta</th></tr></thead><tbody>'
       +gpc.farmacos.map(f=>'<tr><td><span class="dn">'+f.nombre+'</span><span class="dl-c">'+(f.linea?f.linea.toUpperCase()+' LÍNEA':'')+'</span></td>'
         +'<td style="font-size:11px;color:var(--ckm)"><strong>'+( f.clase_farmacologica||'')+'</strong></td>'
         +'<td><strong>'+f.dosis_calculada+'</strong><br><span style="font-size:10px;color:var(--t3)">'+( f.observaciones_clinicas||'')+'</span></td>'
         +'<td>'+f.via+'</td><td>'+f.frecuencia+'</td><td>'+f.duracion+'</td>'
         +'<td style="font-size:11px">'+( f.indicacion_ckm||'')+'</td>'
         +'<td>'+(f.meta_terapeutica?'<span class="mt">'+f.meta_terapeutica+'</span>':'')+'</td></tr>').join('')
       +'</tbody></table></div>'
       +(gpc.advertencia_clinica?'<div class="ab ab-w" style="margin-top:10px"><span class="ai">⚠️</span><span>'+gpc.advertencia_clinica+'</span></div>':'')
       +'</div>':'')
     +'</div>';
  } else if(gpc){
    h+='<div class="gpc"><div class="gh"><div class="gi">📖</div><div><h3>'+(gpc.gpc_nombre||'GPC')+'</h3><p>'+(gpc.gpc_institucion||'')+' '+(gpc.gpc_año?'· '+gpc.gpc_año:'')+'</p></div></div>'
     +(gpc.recomendacion?'<div class="gs"><div class="gsl">✅ Recomendación '+(gpc.nivel_evidencia&&gpc.nivel_evidencia!=='N/A'?'<span class="ev">Evidencia '+gpc.nivel_evidencia+'</span>':'')+'</div><div class="gt">'+gpc.recomendacion+'</div></div>':'')
     +(gpc.punto_buena_practica?'<div class="gs"><div class="gsl">⭐ Punto de buena práctica</div><div class="gt">'+gpc.punto_buena_practica+'</div></div>':'')
     +(gpc.farmacos?.length?'<div class="gs"><div class="gsl">💊 Tratamiento farmacológico</div>'
       +'<div class="dtw dtw-s"><table class="dt dt-s"><thead><tr><th>Fármaco</th><th>Dosis calculada</th><th>Vía</th><th>Frecuencia</th><th>Duración</th><th>Observaciones</th></tr></thead><tbody>'
       +gpc.farmacos.map(f=>'<tr><td><span class="dn">'+f.nombre+'</span><span class="dl">'+(f.linea?f.linea.toUpperCase()+' LÍNEA':'')+' '+(f.indicacion?'· '+f.indicacion:'')+'</span></td><td><strong>'+f.dosis_calculada+'</strong></td><td>'+f.via+'</td><td>'+f.frecuencia+'</td><td>'+f.duracion+'</td><td style="font-size:11px;color:var(--t2)">'+f.observaciones_clinicas+'</td></tr>').join('')
       +'</tbody></table></div>'+(gpc.advertencia_clinica?'<div class="ab ab-w" style="margin-top:10px"><span class="ai">⚠️</span><span>'+gpc.advertencia_clinica+'</span></div>':'')+'</div>':'')
     +'</div>';
  }

  h+='<div class="ab ab-i"><span class="ai">ℹ️</span><span>Orientativo — basado en <strong>NANDA-I 2024-2026, NIC 8ª ed., NOC 7ª ed.</strong>'+(isCKMGpc?' y <strong>Guía CKM 2026 AHA/ACC/ADA/ASN</strong>.':'.') +' El tratamiento debe ser prescrito y ajustado por el médico tratante. Enfermería supervisa administración y efectos adversos.</span></div>';
  h+='<div class="foot">NANDA-I 2024-2026 · NIC 8ª ed. · NOC 7ª ed. · Guía CKM 2026 AHA/ACC/ADA/ASN<br>No sustituye el juicio clínico profesional ni la prescripción médica</div>';

  out.innerHTML=h;out.className='on';
  out.scrollIntoView({behavior:'smooth'});
  window._D={nanda,gpc,info};
}

function exportTxt(){
  const{nanda,gpc,info}=window._D||{};if(!nanda)return;
  const isCKMGpc=gpc&&gpc._ckm;
  let t='DIAGNÓSTICO DE ENFERMERÍA\\n'+'='.repeat(60)+'\\n';
  t+='Fecha: '+new Date().toLocaleDateString('es-MX')+'\\n';
  if(info.age)t+='Edad: '+info.age+' años\\n';
  if(info.sex)t+='Sexo: '+info.sex+'\\n';
  if(info.weight)t+='Peso: '+info.weight+' kg\\n';
  if(info.height)t+='Talla: '+info.height+' cm\\n';
  if(info.imc)t+='IMC: '+info.imc+'\\n';
  if(info.symptoms)t+='Síntomas: '+info.symptoms+'\\n';
  if(info.history)t+='Antecedentes: '+info.history+'\\n';
  t+='\\n';
  (nanda.diagnosticos||[]).forEach((dx,i)=>{
    t+='─'.repeat(60)+'\\nDX '+(i+1)+' · '+(dx.prioridad||'').toUpperCase()+'\\n';
    t+=(dx.nanda_codigo||'')+' '+(dx.nanda_nombre||'')+'\\n'+(dx.nanda_dominio||'')+' · '+(dx.nanda_clase||'')+'\\n\\n';
    if(dx.justificacion)t+='Justificación: '+dx.justificacion+'\\n\\n';
    dx.factores_relacionados?.forEach(f=>t+='r/c '+f+'\\n');
    if(dx.factores_relacionados?.length)t+='\\n';
    dx.caracteristicas_definitorias?.forEach(c=>t+='m/p '+c+'\\n');
    if(dx.caracteristicas_definitorias?.length)t+='\\n';
    dx.noc?.forEach(n=>t+='NOC ['+n.codigo+'] '+n.nombre+'\\n');
    if(dx.noc?.length)t+='\\n';
    dx.nic?.forEach(n=>{
      t+='NIC ['+n.codigo+'] '+n.nombre+'\\n';
      if(n.objetivo)t+='  Objetivo: '+n.objetivo+'\\n';
      n.indicadores?.forEach(ind=>t+='  · '+ind.indicador+' | Basal: '+ind.basal+' → Meta: '+ind.meta+' | '+ind.frecuencia+'\\n');
      n.actividades?.forEach(a=>t+='  • '+a+'\\n');
      t+='\\n';
    });
  });
  if(gpc){
    t+='='.repeat(60)+'\\n'+(isCKMGpc?'GUÍA CKM 2026 AHA/ACC/ADA/ASN':'GUÍA DE PRÁCTICA CLÍNICA')+'\\n'+'='.repeat(60)+'\\n';
    if(isCKMGpc&&gpc.ckm_estadio)t+='Estadio CKM: '+gpc.ckm_estadio+'\\n'+(gpc.ckm_estadio_justificacion||'')+'\\n';
    if(isCKMGpc&&gpc.prevent_riesgo_10a)t+='Riesgo PREVENT 10a: '+gpc.prevent_riesgo_10a+'  |  30a: '+(gpc.prevent_riesgo_30a||'N/D')+'\\n';
    t+='\\n';
    if(gpc.recomendacion)t+='Recomendación (Evidencia '+(gpc.nivel_evidencia||'N/D')+'):\\n'+gpc.recomendacion+'\\n\\n';
    if(gpc.punto_buena_practica)t+='Buena práctica:\\n'+gpc.punto_buena_practica+'\\n\\n';
    gpc.farmacos?.forEach(f=>{
      t+='• '+f.nombre+(f.clase_farmacologica?' ['+f.clase_farmacologica+']':'')+' · '+f.dosis_calculada+' '+f.via+' '+f.frecuencia+' por '+f.duracion;
      if(f.meta_terapeutica)t+=' → '+f.meta_terapeutica;
      t+='\\n';
      if(f.indicacion_ckm)t+='  Indicación CKM: '+f.indicacion_ckm+'\\n';
      if(f.observaciones_clinicas)t+='  Obs: '+f.observaciones_clinicas+'\\n';
    });
    if(gpc.advertencia_clinica)t+='\\n⚠️ '+gpc.advertencia_clinica+'\\n';
  }
  t+='\\n'+'='.repeat(60)+'\\nNANDA-I 2024-2026 · NIC 8ª ed. · NOC 7ª ed.\\nOrientativo — validar con juicio clínico profesional\\n';
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([t],{type:'text/plain;charset=utf-8'}));
  a.download='dx_enfermeria_'+new Date().toISOString().slice(0,10)+'.txt';
  a.click();
}
</script>
</body>
</html>`;

// ── servidor ──────────────────────────────────────────────────
const systemMap = {
  'NANDA':    SYS_NANDA,
  'GPC_STD':  SYS_GPC_STD,
  'CKM_A':    SYS_CKM_A,
  'CKM_B':    SYS_CKM_B
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

  if (req.method === 'POST' && req.url === '/api/diagnose') {
    try {
      const { key, sysKey, user } = JSON.parse(await readBody(req));
      if (!key)             return sendJSON(res, 400, { error: 'API key requerida' });
      if (!user)            return sendJSON(res, 400, { error: 'Datos del paciente requeridos' });
      const sys = systemMap[sysKey];
      if (!sys)             return sendJSON(res, 400, { error: 'Sistema desconocido: ' + sysKey });
      const text = await callAnthropic(key, sys, user);
      return sendJSON(res, 200, { text });
    } catch(e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('OK');
  }

  sendJSON(res, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════════════╗');
  console.log('  ║  🩺  Dx Enfermería · NANDA-I · NIC · NOC · CKM 2026  ║');
  console.log('  ║                                                       ║');
  console.log('  ║  ➜  http://localhost:' + PORT + '                          ║');
  console.log('  ║                                                       ║');
  console.log('  ║  CKM 2026: SGLT2i · GLP-1 RA · RASi · Estatinas     ║');
  console.log('  ║  Se activa con DM2 + HTA / Obesidad / Dislipidemia   ║');
  console.log('  ╚═══════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  Presiona Ctrl+C para detener.');
  console.log('');
});
