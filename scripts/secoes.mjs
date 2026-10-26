// Etapa 2: resultado por SEÇÃO e LOCAL DE VOTAÇÃO, nos dois turnos, a partir dos boletins de urna do TSE.
//   node scripts/secoes.mjs coletar se      → grava saida/se/<municipio>.json
//   node scripts/secoes.mjs nomes           → junta tudo em data/sec/ e acrescenta nome/endereço dos locais (dados abertos do TSE)
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const ANO = "2026";
const PLEITO = { t1: "3220", t2: "3221" };           // pleitos do 1º e 2º turno (configuração do TSE)
const BASE = `https://resultados.tse.jus.br/oficial/ele${ANO}/arquivo-urna`;
const CONC = Number(process.env.CONC || 32);
const dormir = ms => new Promise(r => setTimeout(r, ms));

async function baixar(url, tipo = "text", tentativas = 5) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (painel-2turno-2026)" } });
      if (r.ok) return tipo === "bin" ? new Uint8Array(await r.arrayBuffer()) : await r.text();
      if (r.status === 404) return null;
    } catch {}
    await dormir(800 * (i + 1) ** 2);
  }
  return null;
}

// ---------- leitor DER (ASN.1) mínimo ----------
function der(b, off = 0, end = b.length, prof = 0, out = []) {
  while (off < end) {
    const t = b[off++];
    let len = b[off++];
    if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + b[off++]; }
    out.push({ prof, t, off, len, cons: !!(t & 0x20) });
    if (t & 0x20) der(b, off, off + len, prof + 1, out);
    off += len;
  }
  return out;
}
const inteiro = (b, n) => { let v = 0; for (let i = 0; i < n.len; i++) v = v * 256 + b[n.off + i]; return v; };
const filhos = (nos, i) => { const r = []; for (let j = i + 1; j < nos.length && nos[j].prof > nos[i].prof; j++) if (nos[j].prof === nos[i].prof + 1) r.push(nos[j]); return r; };

// devolve { local, votos: {13, 22, brancos, nulos, validos} } do cargo de Presidente
function lerBU(bytes) {
  const env = der(bytes);
  // identificação no envelope: [0] { {municipio, zona}, local, secao }
  let local = null;
  const iId = env.findIndex(n => n.prof === 1 && n.t === 0xa0);
  if (iId >= 0) { const f = filhos(env, iId); if (f[1]) local = inteiro(bytes, f[1]); }
  const oct = env.find(n => n.prof === 1 && n.t === 0x04);
  if (!oct) return null;
  const b = bytes.subarray(oct.off, oct.off + oct.len), nos = der(b);
  const v = { "13": 0, "22": 0, brancos: 0, nulos: 0, validos: 0 };
  let achou = false;
  nos.forEach((n, i) => {
    if (n.t !== 0x30) return;
    const f = filhos(nos, i);
    // TotalVotosCargo: [1] código do cargo (1 = Presidente), ordem, SEQUENCE de votáveis
    if (!(f[0]?.t === 0x81 && inteiro(b, f[0]) === 1 && f[1]?.t === 0x02 && f[2]?.t === 0x30)) return;
    achou = true;
    const iLista = nos.indexOf(f[2]);
    filhos(nos, iLista).forEach(vt => {
      const g = filhos(nos, nos.indexOf(vt));
      const tipo = g.find(x => x.t === 0x81), qtd = g.find(x => x.t === 0x82), id = g.find(x => x.t === 0xa3);
      if (!tipo || !qtd) return;
      const tp = inteiro(b, tipo), q = inteiro(b, qtd);
      if (tp === 1 && id) { // nominal
        const cod = filhos(nos, nos.indexOf(id)).map(x => inteiro(b, x))[1];
        v.validos += q; if (cod === 13) v["13"] += q; if (cod === 22) v["22"] += q;
      } else if (tp === 2) v.brancos += q;
      else if (tp === 3) v.nulos += q;
    });
  });
  return achou ? { local, v } : null;
}

async function secao(pleito, uf, mu, zona, sec) {
  const dir = `${BASE}/${pleito}/dados/${uf}/${mu}/${zona}/${sec}`;
  const aux = await baixar(`${dir}/p00${pleito}-${uf}-m${mu}-z${zona}-s${sec}-aux.json`);
  if (!aux) return null;
  const j = JSON.parse(aux);
  const h = (j.hashes || []).find(x => /totaliz/i.test(x.st)) || (j.hashes || [])[0];
  const arq = h?.arq?.find(a => a.tp === "bu");
  if (!arq) return null;
  const bu = await baixar(`${dir}/${h.hash}/${arq.nm}`, "bin");
  if (!bu) return null;
  try { return lerBU(bu); } catch { return null; }
}

async function coletar(uf) {
  const cfg = {};
  for (const t of ["t1", "t2"]) {
    const txt = await baixar(`${BASE}/${PLEITO[t]}/config/${uf}/${uf}-p00${PLEITO[t]}-cs.json`);
    cfg[t] = txt ? JSON.parse(txt).abr[0].mu : [];
  }
  const tarefas = [];
  for (const t of ["t1", "t2"]) for (const m of cfg[t]) for (const z of m.zon) for (const s of z.sec)
    tarefas.push({ t, mu: m.cd, nm: m.nm, zona: z.cd, sec: s.ns });
  console.log(`${uf}: ${tarefas.length} boletins para baixar`);
  const mun = {}; let feitos = 0, falhas = 0;
  const fila = tarefas.slice(), ini = Date.now();
  async function trabalhador() {
    while (fila.length) {
      const k = fila.shift();
      const r = await secao(PLEITO[k.t], uf, k.mu, k.zona, k.sec);
      const M = mun[k.mu] ??= { cd: k.mu, nm: k.nm, locais: {} };
      if (r) {
        // a chave é zona + local; dentro dele, as seções
        const chaveLocal = `${Number(k.zona)}-${r.local ?? 0}`;
        const L = M.locais[chaveLocal] ??= { z: Number(k.zona), l: r.local ?? 0, s: {} };
        const S = L.s[Number(k.sec)] ??= {};
        S[k.t] = [r.v["13"], r.v["22"], r.v.validos, r.v.brancos, r.v.nulos];
      } else falhas++;
      if (++feitos % 5000 === 0) console.log(`${uf}: ${feitos}/${tarefas.length} (${Math.round((Date.now() - ini) / 1000)} s, ${falhas} sem boletim)`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, trabalhador));
  // seção que mudou de local entre os turnos: junta tudo no local do 2º turno
  for (const M of Object.values(mun)) {
    const ondeT2 = {};
    for (const [k, L] of Object.entries(M.locais)) for (const [s, S] of Object.entries(L.s)) if (S.t2) ondeT2[`${L.z}-${s}`] = k;
    for (const [k, L] of Object.entries(M.locais)) for (const [s, S] of Object.entries(L.s)) {
      const alvo = ondeT2[`${L.z}-${s}`];
      if (alvo && alvo !== k && !S.t2) { const D = M.locais[alvo].s[s] ??= {}; if (S.t1) D.t1 = S.t1; delete L.s[s]; }
    }
    for (const [k, L] of Object.entries(M.locais)) if (!Object.keys(L.s).length) delete M.locais[k];
  }
  fs.mkdirSync(`saida/${uf}`, { recursive: true });
  for (const M of Object.values(mun)) fs.writeFileSync(`saida/${uf}/${M.cd}.json`, JSON.stringify(M));
  console.log(`${uf}: pronto — ${Object.keys(mun).length} cidades, ${feitos} boletins, ${falhas} sem boletim, ${Math.round((Date.now() - ini) / 60000)} min`);
}

// ---------- nomes e endereços dos locais (dados abertos do TSE) ----------
function lerCSV(arquivo, cada) {
  const txt = new TextDecoder("latin1").decode(fs.readFileSync(arquivo));
  const linhas = txt.split(/\r?\n/);
  const cab = linhas[0].split(";").map(c => c.replace(/"/g, "").trim());
  for (let i = 1; i < linhas.length; i++) {
    if (!linhas[i]) continue;
    const c = linhas[i].split(";").map(x => x.replace(/^"|"$/g, ""));
    const o = {}; cab.forEach((h, k) => o[h] = c[k]); cada(o);
  }
}
async function nomes() {
  const locais = {};
  try {
    execSync(`curl -sSL --fail -o locais.zip https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_${ANO}.zip && unzip -o -q locais.zip -d locais`, { stdio: "inherit" });
    for (const f of fs.readdirSync("locais").filter(f => /\.csv$/i.test(f))) {
      lerCSV(path.join("locais", f), o => {
        if (o.NR_TURNO && o.NR_TURNO !== "2" && o.NR_TURNO !== "1") return;
        const k = `${(o.SG_UF || "").toLowerCase()}|${Number(o.CD_MUNICIPIO)}|${Number(o.NR_ZONA)}-${Number(o.NR_LOCAL_VOTACAO)}`;
        if (locais[k] && o.NR_TURNO === "1") return;
        const lat = parseFloat(String(o.NR_LATITUDE).replace(",", ".")), lon = parseFloat(String(o.NR_LONGITUDE).replace(",", "."));
        locais[k] = { nm: o.NM_LOCAL_VOTACAO, end: o.DS_ENDERECO, br: o.NM_BAIRRO,
          lat: Math.abs(lat) > 0.01 && lat !== -1 ? lat : null, lon: Math.abs(lon) > 0.01 && lon !== -1 ? lon : null };
      });
    }
    console.log(`nomes de locais: ${Object.keys(locais).length}`);
  } catch (e) { console.log("arquivo de locais do TSE indisponível — os locais ficam só com o número"); }

  fs.mkdirSync("data/sec", { recursive: true });
  for (const uf of fs.readdirSync("saida")) {
    fs.mkdirSync(`data/sec/${uf}`, { recursive: true });
    for (const f of fs.readdirSync(`saida/${uf}`)) {
      const M = JSON.parse(fs.readFileSync(`saida/${uf}/${f}`, "utf8"));
      for (const [k, L] of Object.entries(M.locais)) {
        const info = locais[`${uf}|${Number(M.cd)}|${k}`];
        if (info) Object.assign(L, info);
      }
      fs.writeFileSync(`data/sec/${uf}/${f}`, JSON.stringify(M));
    }
  }
}

const [, , cmd, uf] = process.argv;
if (cmd === "coletar") await coletar(uf);
else if (cmd === "nomes") await nomes();
else console.log("uso: node scripts/secoes.mjs coletar <uf> | nomes");
