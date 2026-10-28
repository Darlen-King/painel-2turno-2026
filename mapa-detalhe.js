// Mapa detalhado: Brasil → estado → cidades → colégios eleitorais → seções
// modos: quem cresceu (p.p.) · quem venceu · quem perdeu votos do 1º para o 2º turno
const BASE = "https://resultados.tse.jus.br/oficial";
const ANO = "2026", T2 = "6258", T1 = "6257";
const UFS = ["ac","al","am","ap","ba","ce","df","es","go","ma","mg","ms","mt","pa","pb","pe","pi","pr","rj","rn","ro","rr","rs","sc","se","sp","to"];
const NOMES = { "13": "LULA", "22": "FLAVIO BOLSONARO" };
const LIM = { cresc: 15, venc: 30, perda: 10 };  // perda: % dos votos do 1º turno

const $ = id => document.getElementById(id);
const pad = c => String(c).padStart(6, "0");
const num = s => typeof s === "number" ? s : parseFloat(String(s ?? "0").replace(/\./g, "").replace(",", "."));
const pctNum = s => typeof s === "number" ? s : parseFloat(String(s ?? "0").replace(",", "."));
const fmt = n => Number(n || 0).toLocaleString("pt-BR");
const pctFmt = (n, d = 2) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const sinalV = v => (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v));  // votos com sinal
const sinal = (v, d = 1) => (v > 0 ? "+" : v < 0 ? "−" : "") + pctFmt(Math.abs(v), d);
const corNum = n => n === "13" ? "var(--a)" : "var(--b)";
const txtNum = n => n === "13" ? "var(--a)" : "var(--b-txt)";
const primeiro = n => (NOMES[n] || n).split(" ")[0];
const semAcento = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function decodeJws(txt) {
  const t = txt.trim();
  if (t.startsWith("{")) return JSON.parse(t);
  let b = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  return JSON.parse(new TextDecoder("utf-8").decode(Uint8Array.from(atob(b), c => c.charCodeAt(0))));
}
async function tse(caminho) {
  const r = await fetch(`${BASE}/ele${ANO}/${caminho}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return decodeJws(await r.text());
}
// extrai {13:[votos,%], 22:[votos,%]} e % de seções apuradas de um arquivo do TSE
function resumo(j) {
  const o = { pst: pctNum(j.s?.pst) };
  ((j.carg || [])[0]?.agr || []).forEach(ag => (ag.par || []).forEach(p => (p.cand || []).forEach(c => {
    if (c.n === "13" || c.n === "22") { o[c.n] = [num(c.vap), pctNum(c.pvap)]; if (c.nmu) NOMES[c.n] = c.nmu; }
  })));
  return o;
}

// ---------- métricas ----------
function calc(it) {
  if (!it || !it.t1 || !it.t2 || !it.t1["13"] || !it.t1["22"] || !it.t2["13"] || !it.t2["22"]) return null;
  const g13 = it.t2["13"][1] - it.t1["13"][1], g22 = it.t2["22"][1] - it.t1["22"][1];
  const lid = it.t2["22"][0] > it.t2["13"][0] ? "22" : "13";
  // votos ganhos (+) ou perdidos (−) do 1º para o 2º turno, e em % dos votos que tinha no 1º
  const v13 = it.t2["13"][0] - it.t1["13"][0], v22 = it.t2["22"][0] - it.t1["22"][0];
  const r13 = it.t1["13"][0] ? v13 / it.t1["13"][0] * 100 : 0, r22 = it.t1["22"][0] ? v22 / it.t1["22"][0] * 100 : 0;
  const quemPerde = v13 < 0 || v22 < 0 ? (v13 < v22 ? "13" : "22") : null;
  return {
    g13, g22, saldo: g22 - g13, quemCresc: g22 - g13 >= 0 ? "22" : "13",
    v13, v22, r13, r22, quemPerde,
    perdeu: quemPerde ? -(quemPerde === "13" ? v13 : v22) : 0,
    rPerdeu: quemPerde ? -(quemPerde === "13" ? r13 : r22) : 0,
    lid, dp: Math.abs(it.t2["22"][1] - it.t2["13"][1]), dv: Math.abs(it.t2["22"][0] - it.t2["13"][0])
  };
}
const intens = (v, lim) => 0.28 + Math.min(Math.abs(v), lim) / lim * 0.72;
function pintura(it) {
  const m = calc(it);
  if (!m) return { fill: "var(--line)", op: 1 };
  if (modo === "perda") return m.quemPerde ? { fill: corNum(m.quemPerde), op: intens(m.rPerdeu, LIM.perda) } : { fill: "var(--muted)", op: 0.45 };
  return modo === "cresc" ? { fill: corNum(m.quemCresc), op: intens(m.saldo, LIM.cresc) }
                          : { fill: corNum(m.lid), op: intens(m.dp, LIM.venc) };
}

// ---------- estado da página ----------
const modoUrl = new URLSearchParams(location.search).get("modo");
let modo = ["venc", "perda"].includes(modoUrl) ? modoUrl : "cresc"; // cresc | venc | perda
let nav = { uf: null, mun: null, loc: null };   // onde estamos: Brasil › UF › cidade › local
let nivel = "BR";              // BR | UF | MUN | LOC
let itens = [];                // o que aparece na lista
let mapaItens = [];            // o que aparece no mapa
let ordem = "saldo", busca = "", selId = null;
const dadosUF = {};            // UF -> {t1, t2}
const cacheMun = {};           // UF -> { vb, itens, proj }
const cacheSec = {};           // "uf/cd" -> dados por seção (ou null)
let configMun = null;
let contorno = null;           // contorno da cidade (níveis MUN e LOC)

// ---------- projeção ----------
const K = Math.cos(15 * Math.PI / 180);
function projetar(features, largura = 1000) {
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  const polys = features.map(f => {
    const g = f.geometry, arr = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    arr.forEach(p => p[0].forEach(([x, y]) => {
      const X = x * K, Y = -y; minx = Math.min(minx, X); maxx = Math.max(maxx, X); miny = Math.min(miny, Y); maxy = Math.max(maxy, Y);
    }));
    return arr;
  });
  const S = largura / (maxx - minx), H = (maxy - miny) * S;
  const proj = (x, y) => [(x * K - minx) * S, (-y - miny) * S];
  const shapes = polys.map(arr => {
    let d = "", area = 0, cx = 0, cy = 0, bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    arr.forEach(p => p.forEach((anel, i) => {
      const pts = anel.map(([x, y]) => proj(x, y));
      pts.forEach(([x, y]) => { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); });
      d += "M" + pts.map(q => q[0].toFixed(1) + " " + q[1].toFixed(1)).join("L") + "Z";
      if (i === 0) {
        let a = 0, sx = 0, sy = 0;
        for (let k = 0; k < pts.length - 1; k++) {
          const [x0, y0] = pts[k], [x1, y1] = pts[k + 1], c = x0 * y1 - x1 * y0;
          a += c; sx += (x0 + x1) * c; sy += (y0 + y1) * c;
        }
        if (Math.abs(a) > Math.abs(area)) { area = a; cx = sx / (3 * a); cy = sy / (3 * a); }
      }
    }));
    return { d, cx, cy, bbox: { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 } };
  });
  return { shapes, vb: { x: 0, y: 0, w: largura, h: H }, proj };
}

// ---------- carregamento ----------
async function carregarBrasil() {
  status("Carregando estados…");
  await Promise.allSettled(UFS.map(async uf => {
    const [a, b] = await Promise.all([
      tse(`${T1}/dados/${uf}/${uf}-c0001-e${pad(T1)}-u.jws`),
      tse(`${T2}/dados/${uf}/${uf}-c0001-e${pad(T2)}-u.jws`)
    ]);
    dadosUF[uf.toUpperCase()] = { t1: resumo(a), t2: resumo(b) };
  }));
  status("");
}
async function lerConfigMun() {
  if (configMun) return configMun;
  configMun = await tse(`${T2}/config/mun-e${pad(T2)}-cm.jws`);
  return configMun;
}
async function geoUF(uf) {
  try { const r = await fetch(`data/geo/${uf.toLowerCase()}.json`); if (r.ok) return await r.json(); } catch {}
  const r = await fetch(`https://servicodados.ibge.gov.br/api/v3/malhas/estados/${uf}?intrarregiao=municipio&formato=application/vnd.geo+json&qualidade=minima`);
  if (!r.ok) throw new Error("mapa do IBGE indisponível");
  return r.json();
}
async function resultadosMun(uf) {
  try {
    const r = await fetch(`data/mun/${uf.toLowerCase()}.json`);
    if (r.ok) { const j = await r.json(); if (j.mun?.length) return j.mun; }
  } catch {}
  const cfg = await lerConfigMun();
  const lista = (cfg.abr.find(a => a.cd === uf.toLowerCase())?.mu || []);
  const out = []; let feitos = 0;
  const fila = lista.slice();
  async function trabalhador() {
    while (fila.length) {
      const m = fila.shift(), u = uf.toLowerCase();
      try {
        const [a, b] = await Promise.all([
          tse(`${T1}/dados/${u}/${u}${m.cd}-c0001-e${pad(T1)}-u.jws`),
          tse(`${T2}/dados/${u}/${u}${m.cd}-c0001-e${pad(T2)}-u.jws`)
        ]);
        out.push({ cd: m.cd, cdi: m.cdi, nm: m.nm, t1: resumo(a), t2: resumo(b) });
      } catch { out.push({ cd: m.cd, cdi: m.cdi, nm: m.nm }); }
      feitos++;
      if (feitos % 10 === 0 || feitos === lista.length) status(`Carregando cidades do TSE… ${feitos} de ${lista.length}`, feitos / lista.length);
    }
  }
  await Promise.all(Array.from({ length: 12 }, trabalhador));
  return out;
}
async function garantirUF(uf) {
  if (cacheMun[uf]) return cacheMun[uf];
  status(`Carregando mapa de ${MAPA_UF[uf]?.nome || uf}…`);
  const [geo, res] = await Promise.all([geoUF(uf), resultadosMun(uf)]);
  const porIBGE = {}; res.forEach(m => porIBGE[String(m.cdi)] = m);
  const feats = geo.features || [];
  const { shapes, vb, proj } = projetar(feats);
  cacheMun[uf] = {
    vb, proj, itens: feats.map((f, i) => {
      const cod = String(f.properties?.codarea || f.properties?.id || ""), m = porIBGE[cod] || {};
      return { id: m.cd || cod, cdi: cod, nm: m.nm || cod, ...shapes[i], t1: m.t1, t2: m.t2 };
    })
  };
  status("");
  return cacheMun[uf];
}
async function garantirSec(uf, cd) {
  const k = `${uf}/${cd}`;
  if (k in cacheSec) return cacheSec[k];
  status("Carregando colégios e seções…");
  try {
    const r = await fetch(`data/sec/${uf.toLowerCase()}/${cd}.json`);
    cacheSec[k] = r.ok ? await r.json() : null;
  } catch { cacheSec[k] = null; }
  status("");
  return cacheSec[k];
}

// soma votos de um conjunto de seções → formato {t1:{13:[v,%],22:[v,%]}, t2:{...}}
function somar(lista) {
  const out = {};
  for (const t of ["t1", "t2"]) {
    let a = 0, b = 0, val = 0, br = 0, nu = 0, n = 0;
    lista.forEach(S => { if (S[t]) { a += S[t][0]; b += S[t][1]; val += S[t][2]; br += S[t][3] || 0; nu += S[t][4] || 0; n++; } });
    if (n && val) out[t] = { "13": [a, a / val * 100], "22": [b, b / val * 100], val, br, nu, n, pst: 100 };
  }
  return out;
}
const nomeLocal = (L) => L.nm ? L.nm : `Local nº ${L.l}`;

// ---------- navegação ----------
function lerHash() {
  const [uf, mun, loc] = decodeURIComponent(location.hash.replace("#", "")).split("/");
  return { uf: uf && MAPA_UF[uf.toUpperCase()] ? uf.toUpperCase() : null, mun: mun || null, loc: loc || null };
}
const irPara = (uf, mun, loc) => { location.hash = [uf, mun, loc].filter(Boolean).join("/"); };

async function rota() {
  nav = lerHash(); selId = null; busca = ""; $("busca").value = "";
  if (!nav.uf) return mostrarBrasil();
  try {
    const U = await garantirUF(nav.uf);
    if (!nav.mun) return mostrarUF(U);
    const cid = U.itens.find(c => c.id === nav.mun);
    const dados = await garantirSec(nav.uf, nav.mun);
    if (lerHash().mun !== nav.mun) return;
    mostrarCidade(U, cid, dados);
  } catch (e) { status("Não consegui carregar: " + e.message); }
}

function mostrarBrasil() {
  nivel = "BR"; contorno = null;
  mapaItens = itens = Object.entries(MAPA_UF).map(([uf, m]) => ({ id: uf, nm: m.nome, d: m.d, cx: m.cx, cy: m.cy, ...(dadosUF[uf] || {}) }));
  const [, , w, h] = MAPA_VIEWBOX.split(" ").map(Number);
  baseVB = { x: 0, y: 0, w, h };
  desenhar(true);
}
function mostrarUF(U) {
  nivel = "UF"; contorno = null;
  mapaItens = itens = U.itens; baseVB = U.vb;
  desenhar(true);
}
function mostrarCidade(U, cid, dados) {
  contorno = cid || null;
  const b = cid?.bbox || U.vb, m = Math.max(b.w, b.h) * 0.08;
  baseVB = { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m };
  if (!dados) {
    nivel = "MUN"; mapaItens = itens = [];
    desenhar(true);
    status(`Os colégios e seções de ${cid?.nm || "esta cidade"} ainda estão sendo processados pelo robô do GitHub. Volte em algumas horas.`);
    return;
  }
  // locais (colégios) com a soma das suas seções
  const raioBase = Math.max(baseVB.w, baseVB.h) * 0.011;
  const locais = Object.entries(dados.locais).map(([k, L]) => {
    const secs = Object.values(L.s), soma = somar(secs);
    const pt = L.lat != null && L.lon != null ? U.proj(L.lon, L.lat) : null;
    return { id: k, tipo: "pt", nm: nomeLocal(L), sub: [L.br, L.end].filter(Boolean).join(" · "), z: L.z, l: L.l,
      x: pt?.[0], y: pt?.[1], nsec: secs.length, ...soma, raw: L };
  });
  const medio = locais.reduce((a, x) => a + (x.t2?.val || 0), 0) / Math.max(locais.length, 1) || 1;
  locais.forEach(x => x.r = raioBase * Math.min(Math.max(Math.sqrt((x.t2?.val || medio) / medio), 0.6), 2.4));
  mapaItens = locais;
  if (nav.loc && dados.locais[nav.loc]) {
    nivel = "LOC";
    const L = dados.locais[nav.loc];
    itens = Object.entries(L.s).map(([s, S]) => ({ id: `${L.z}-${s}`, nm: `Seção ${s}`, sub: `Zona ${L.z}`, ...somar([S]), raw: S }))
      .sort((a, b) => Number(a.nm.slice(6)) - Number(b.nm.slice(6)));
    selId = nav.loc;
  } else {
    nivel = "MUN"; itens = locais;
  }
  desenhar(true);
  const semPt = locais.filter(x => x.x == null).length;
  if (semPt) status(semPt === locais.length
    ? "Os colégios ainda não têm localização no mapa (o arquivo de endereços do TSE não foi encontrado) — use a lista ao lado."
    : `${semPt} de ${locais.length} colégios sem localização no mapa — eles aparecem só na lista.`);
}

// ---------- desenho ----------
let baseVB = { x: 0, y: 0, w: 600, h: 618 }, vb = { ...baseVB };
function aplicarVB() { $("mapa").setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`); }

function desenhar(resetZoom) {
  const svg = $("mapa");
  if (resetZoom) { vb = { ...baseVB }; aplicarVB(); }
  const br = nivel === "BR", pontos = nivel === "MUN" || nivel === "LOC";
  let html = "";
  if (pontos) {
    if (contorno) html += `<path d="${contorno.d}" class="contorno"/>`;
    html += mapaItens.filter(it => it.x != null).sort((a, b) => b.r - a.r).map(it => {
      const p = pintura(it), apagado = nivel === "LOC" && it.id !== nav.loc;
      return `<circle data-id="${it.id}" cx="${it.x.toFixed(2)}" cy="${it.y.toFixed(2)}" r="${it.r.toFixed(2)}" style="fill:${p.fill};fill-opacity:${apagado ? p.op * 0.35 : p.op}" class="${it.id === selId ? "sel" : ""}"/>`;
    }).join("");
  } else {
    html = mapaItens.map(it => {
      const p = pintura(it);
      return `<path data-id="${it.id}" d="${it.d}" style="fill:${p.fill};fill-opacity:${p.op}" class="${it.id === selId ? "sel" : ""}"/>`;
    }).join("") + (br ? mapaItens.map(it => `<text x="${it.cx}" y="${it.cy}" class="maplbl ${["DF","SE","AL","RN","PB","ES","RJ"].includes(it.id) ? "sm" : ""}">${it.id}</text>`).join("") : "");
  }
  svg.innerHTML = html;
  svg.classList.toggle("muni", !br);
  // trilha
  const partes = [`<a href="#">Brasil</a>`];
  if (nav.uf) partes.push(`<a href="#${nav.uf}">${MAPA_UF[nav.uf]?.nome || nav.uf}</a>`);
  if (nav.mun) partes.push(`<a href="#${nav.uf}/${nav.mun}">${contorno?.nm || nav.mun}</a>`);
  if (nivel === "LOC") partes.push(`<span>${nomeLocal(cacheSec[`${nav.uf}/${nav.mun}`].locais[nav.loc])}</span>`);
  partes[partes.length - 1] = partes[partes.length - 1].replace(/<a [^>]*>(.*)<\/a>/, "<b>$1</b>").replace(/<span>(.*)<\/span>/, "<b>$1</b>");
  $("trilha").innerHTML = partes.join(" › ");
  $("dica").textContent = {
    BR: "Clique num estado para ver as cidades · roda do mouse ou + e − para dar zoom",
    UF: "Clique numa cidade para ver os colégios eleitorais · arraste para mover · roda do mouse ou + e − para zoom",
    MUN: "Cada bolinha é um colégio eleitoral (tamanho = número de votos) · clique para ver as seções",
    LOC: "Lista: as seções deste colégio · clique em outra bolinha para trocar de colégio"
  }[nivel];
  lista(); placar(); legenda();
}

function unidade(plural = true) {
  return { BR: plural ? "estados" : "Estado", UF: plural ? "cidades" : "Cidade", MUN: plural ? "colégios" : "Colégio eleitoral", LOC: plural ? "seções" : "Seção" }[nivel];
}
function placar() {
  const c = { "13": 0, "22": 0 }; let sem = 0, ninguem = 0;
  itens.forEach(it => {
    const m = calc(it); if (!m) { sem++; return; }
    if (modo === "perda") { if (m.quemPerde) c[m.quemPerde]++; else ninguem++; }
    else c[modo === "cresc" ? m.quemCresc : m.lid]++;
  });
  const sufixo = { cresc: " onde cresceu mais", perda: " onde perdeu mais votos", venc: "" }[modo];
  $("placar").innerHTML = itens.length ? ["13", "22"].map(n =>
    `<span><i style="background:${corNum(n)}"></i>${NOMES[n]}: <b>${c[n]}</b> ${unidade()}${sufixo}</span>`).join("") +
    (modo === "perda" && ninguem ? `<span><i style="background:var(--muted);opacity:.35"></i>Ninguém perdeu: <b>${ninguem}</b></span>` : "") +
    (sem && nivel !== "BR" ? `<span class="mini">${sem} sem dados</span>` : "") : "";
}

function legenda() {
  if (modo === "perda") {
    const cor = (n, v) => `color-mix(in srgb, ${corNum(n)} ${Math.round(intens(v, LIM.perda) * 100)}%, var(--card))`;
    $("legenda").innerHTML = `
    <div class="lgTit">Quem perdeu mais votos do 1º para o 2º turno (em % dos próprios votos do 1º turno)</div>
    <div class="lgBar" style="background:linear-gradient(90deg, ${cor("13", LIM.perda)} 0%, ${cor("13", 0)} 49.5%, ${cor("22", 0)} 50.5%, ${cor("22", LIM.perda)} 100%)"></div>
    <div class="lgEsc">${[10, 5, 0, 5, 10].map((v, i) => `<span>${v}%${i === 0 || i === 4 ? "+" : ""}</span>`).join("")}</div>
    <div class="lgLados"><span style="color:var(--a)">◀ ${primeiro("13")} perdeu mais votos</span><span style="color:var(--b-txt)">${primeiro("22")} perdeu mais votos ▶</span></div>
    <div class="lgNota"><i class="lgSem" style="background:color-mix(in srgb, var(--muted) 45%, var(--card))"></i> os dois ganharam votos · <i class="lgSem"></i> sem dados · mais forte = perdeu uma parte maior do que tinha</div>`;
    return;
  }
  const lim = LIM[modo], cresc = modo === "cresc";
  const passos = cresc ? [15, 10, 5, 0, 5, 10, 15] : [30, 20, 10, 0, 10, 20, 30];
  const cor = (n, v) => `color-mix(in srgb, ${corNum(n)} ${Math.round(intens(v, lim) * 100)}%, var(--card))`;
  $("legenda").innerHTML = `
    <div class="lgTit">${cresc ? "Quem cresceu mais do 1º para o 2º turno (pontos percentuais)" : "Quem vence no 2º turno (vantagem em pontos percentuais)"}</div>
    <div class="lgBar" style="background:linear-gradient(90deg, ${cor("13", lim)} 0%, ${cor("13", 0)} 49.5%, ${cor("22", 0)} 50.5%, ${cor("22", lim)} 100%)"></div>
    <div class="lgEsc">${passos.map((v, i) => `<span>${i === 0 || i === passos.length - 1 ? v + "+" : v}</span>`).join("")}</div>
    <div class="lgLados"><span style="color:var(--a)">◀ ${primeiro("13")} ${cresc ? "cresceu mais" : "vence"}</span><span style="color:var(--b-txt)">${primeiro("22")} ${cresc ? "cresceu mais" : "vence"} ▶</span></div>
    <div class="lgNota"><i class="lgSem"></i> sem dados · cor mais forte = ${cresc ? "diferença de crescimento maior" : "vantagem maior"}</div>`;
}

function lista() {
  const cresc = modo === "cresc", perd = modo === "perda";
  const tit = {
    BR: "Estados",
    UF: `Cidades de ${MAPA_UF[nav.uf]?.nome || nav.uf} (${itens.length})`,
    MUN: `Colégios eleitorais de ${contorno?.nm || ""} (${itens.length})`,
    LOC: nivel === "LOC" ? `Seções de ${nomeLocal(cacheSec[`${nav.uf}/${nav.mun}`].locais[nav.loc])} (${itens.length})` : ""
  }[nivel];
  $("listaTit").textContent = tit;
  $("busca").hidden = nivel === "BR" || nivel === "LOC";
  $("busca").placeholder = nivel === "MUN" ? "Buscar colégio ou bairro…" : "Buscar cidade…";
  $("lHead").innerHTML = `<tr><th data-o="nome">${unidade(false)}</th>
    <th class="r" style="color:var(--a)">${primeiro("13")}<div class="mini">${cresc || perd ? "1º → 2º" : "2º turno"}</div></th>
    <th class="r" style="color:var(--b-txt)">${primeiro("22")}<div class="mini">${cresc || perd ? "1º → 2º" : "2º turno"}</div></th>
    <th class="r" data-o="saldo">${cresc ? "Cresceu mais" : perd ? "Perdeu mais" : "Vantagem"}</th></tr>`;
  $("lHead").querySelectorAll("[data-o]").forEach(th => { th.classList.toggle("on", th.dataset.o === ordem); th.onclick = () => { ordem = th.dataset.o; lista(); }; });
  const q = semAcento(busca);
  const val = it => { const m = calc(it); return !m ? -1e9 : cresc ? m.saldo : perd ? m.perdeu : (m.lid === "22" ? m.dp : -m.dp); };
  const vis = itens.filter(it => !q || semAcento(it.nm + " " + (it.sub || "")).includes(q))
    .sort((a, b) => ordem === "nome" ? a.nm.localeCompare(b.nm, "pt-BR", { numeric: true }) : val(b) - val(a));
  $("lBody").innerHTML = vis.map(it => {
    const m = calc(it);
    if (!m) return `<tr data-id="${it.id}"><td>${nomeItem(it)}</td><td colspan="3" class="r mini">sem dados</td></tr>`;
    const cel = n => cresc
      ? `<span class="t12">${pctFmt(it.t1[n][1], 1)} → ${pctFmt(it.t2[n][1], 1)}</span><div class="mini" style="color:${txtNum(n)}">${sinal(it.t2[n][1] - it.t1[n][1])} p.p.</div><div class="mini">${sinalV(m["v" + n])} votos</div>`
      : perd
      ? `<span class="t12">${fmt(it.t1[n][0])} → ${fmt(it.t2[n][0])}</span><div class="mini" style="color:${m["v" + n] < 0 ? txtNum(n) : "var(--muted)"}">${sinalV(m["v" + n])} votos</div><div class="mini">${sinal(m["r" + n])}%</div>`
      : `<span class="${m.lid === n ? "win" : ""}">${pctFmt(it.t2[n][1], 1)}%</span><div class="mini">${fmt(it.t2[n][0])}</div>`;
    let chip;
    if (perd) chip = m.quemPerde
      ? `<span class="chip" style="--c:${corNum(m.quemPerde)};--t:${txtNum(m.quemPerde)}">${primeiro(m.quemPerde)} −${fmt(m.perdeu)}</span><div class="mini">−${pctFmt(m.rPerdeu, 1)}%</div>`
      : `<span class="chip" style="--c:var(--muted)">ninguém</span>`;
    else {
      const quem = cresc ? m.quemCresc : m.lid, v = cresc ? Math.abs(m.saldo) : m.dp;
      chip = `<span class="chip" style="--c:${corNum(quem)};--t:${txtNum(quem)}">${primeiro(quem)} +${pctFmt(v, 1)}</span>`;
    }
    return `<tr data-id="${it.id}" class="${it.id === selId ? "sel" : ""}"><td>${nomeItem(it)}</td><td class="r">${cel("13")}</td><td class="r">${cel("22")}</td>
      <td class="r">${chip}</td></tr>`;
  }).join("") || `<tr><td colspan="4" class="mini">${itens.length ? "Nada encontrado." : "Sem dados para mostrar."}</td></tr>`;
  $("lBody").querySelectorAll("tr[data-id]").forEach(tr => {
    tr.onmouseenter = () => realcar(tr.dataset.id, true);
    tr.onclick = () => clicar(tr.dataset.id, true);
  });
}
function nomeItem(it) {
  if (nivel === "BR") return `<b>${it.id}</b> <span class="ufnm">${it.nm}</span>`;
  if (nivel === "MUN") return `<b>${it.nm}</b><div class="mini">${[it.sub, `zona ${it.z} · local ${it.l} · ${it.nsec} ${it.nsec === 1 ? "seção" : "seções"}`].filter(Boolean).join("<br>")}</div>`;
  if (nivel === "LOC") return `<b>${it.nm}</b> <span class="mini">${it.sub}</span>`;
  return `<b>${it.nm}</b>`;
}

function dicaHTML(it) {
  const m = calc(it);
  const cab = `<b>${it.nm}</b>${it.sub ? `<div class="mini">${it.sub}</div>` : ""}`;
  if (!m) return `${cab}<span class="mini">sem dados</span>`;
  const linha = n => `<span style="color:${txtNum(n)}">${NOMES[n]}: ${pctFmt(it.t1[n][1])}% → <b>${pctFmt(it.t2[n][1])}%</b> (${sinal(it.t2[n][1] - it.t1[n][1], 2)} p.p.)</span>` +
    `<br><span class="mini">&nbsp;&nbsp;${fmt(it.t1[n][0])} → ${fmt(it.t2[n][0])} votos (${sinalV(m["v" + n])})</span>`;
  const conclusao = modo === "perda"
    ? (m.quemPerde ? `<b style="color:${txtNum(m.quemPerde)}">${NOMES[m.quemPerde]} perdeu ${fmt(m.perdeu)} votos (−${pctFmt(m.rPerdeu, 1)}%)</b>` : `<b>Os dois ganharam votos</b>`)
    : `<b style="color:${txtNum(m.quemCresc)}">${NOMES[m.quemCresc]} cresceu ${pctFmt(Math.abs(m.saldo), 2)} p.p. a mais</b>`;
  const votos = it.t2.val != null
    ? `<br><span class="mini">2º turno: ${fmt(it.t2["13"][0])} × ${fmt(it.t2["22"][0])} votos · ${fmt(it.t2.br)} brancos · ${fmt(it.t2.nu)} nulos${it.nsec ? ` · ${it.nsec} seções` : ""}</span>`
    : `<br><span class="mini">2º turno: ${NOMES[m.lid]} vence por ${fmt(m.dv)} votos (${pctFmt(m.dp, 2)} p.p.)</span>`;
  return `${cab}<span class="mini">1º → 2º turno</span><br>${linha("13")}<br>${linha("22")}<br>
    ${conclusao}${votos}`;
}
function realcar(id, daLista) {
  const fonte = daLista ? itens : mapaItens;
  const it = fonte.find(x => x.id === id) || itens.find(x => x.id === id) || mapaItens.find(x => x.id === id), tip = $("tip");
  document.querySelectorAll("#mapa [data-id]").forEach(p => p.classList.toggle("hov", p.dataset.id === id));
  if (!it) { tip.hidden = true; return; }
  tip.hidden = false; tip.innerHTML = dicaHTML(it);
}
function clicar(id, daLista) {
  if (nivel === "BR") return irPara(id);
  if (nivel === "UF") return irPara(nav.uf, id);
  if (nivel === "MUN" || (nivel === "LOC" && !daLista)) return irPara(nav.uf, nav.mun, id);
  // nível LOC, clique numa seção da lista: só destaca
  selId = id;
  document.querySelectorAll("#lBody tr").forEach(tr => tr.classList.toggle("sel", tr.dataset.id === id));
  realcar(id, true);
}

function status(t, frac) {
  $("status").hidden = !t; $("statusTxt").textContent = t || "";
  $("statusBar").style.width = frac == null ? "0" : (frac * 100) + "%";
  $("statusBar").parentElement.hidden = frac == null;
}

// ---------- zoom e arrastar ----------
function limitar() {
  vb.w = Math.min(Math.max(vb.w, baseVB.w / 40), baseVB.w * 1.2); vb.h = vb.w * baseVB.h / baseVB.w;
  vb.x = Math.min(Math.max(vb.x, baseVB.x - vb.w * 0.5), baseVB.x + baseVB.w - vb.w * 0.5);
  vb.y = Math.min(Math.max(vb.y, baseVB.y - vb.h * 0.5), baseVB.y + baseVB.h - vb.h * 0.5);
}
function zoom(f, cx, cy) {
  const nx = cx ?? vb.x + vb.w / 2, ny = cy ?? vb.y + vb.h / 2;
  vb.x = nx - (nx - vb.x) * f; vb.y = ny - (ny - vb.y) * f; vb.w *= f; vb.h *= f; limitar(); aplicarVB();
}
function ptSVG(ev) {
  const r = $("mapa").getBoundingClientRect(), s = Math.max(vb.w / r.width, vb.h / r.height);
  const ox = (r.width - vb.w / s) / 2, oy = (r.height - vb.h / s) / 2;
  return [vb.x + (ev.clientX - r.left - ox) * s, vb.y + (ev.clientY - r.top - oy) * s];
}
(function interacao() {
  const svg = $("mapa"), pontos = new Map();
  let arrastou = false, ini = null, distIni = 0, vbIni = null;
  svg.addEventListener("wheel", ev => { ev.preventDefault(); const [x, y] = ptSVG(ev); zoom(ev.deltaY > 0 ? 1.18 : 1 / 1.18, x, y); }, { passive: false });
  svg.addEventListener("pointerdown", ev => {
    pontos.set(ev.pointerId, ev); svg.setPointerCapture(ev.pointerId);
    arrastou = false; ini = { x: ev.clientX, y: ev.clientY }; vbIni = { ...vb };
    if (pontos.size === 2) { const [a, b] = [...pontos.values()]; distIni = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
  });
  svg.addEventListener("pointermove", ev => {
    if (!pontos.has(ev.pointerId)) {
      const alvo = ev.target.closest?.("[data-id]");
      if (alvo) realcar(alvo.dataset.id, false);
      return;
    }
    pontos.set(ev.pointerId, ev);
    const r = svg.getBoundingClientRect(), s = Math.max(vb.w / r.width, vb.h / r.height);
    if (pontos.size === 2) {
      const [a, b] = [...pontos.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (distIni) { vb = { ...vbIni }; const m = { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 }; const [x, y] = ptSVG(m); zoom(distIni / d, x, y); arrastou = true; }
      return;
    }
    const dx = ev.clientX - ini.x, dy = ev.clientY - ini.y;
    if (Math.hypot(dx, dy) > 5) arrastou = true;
    if (arrastou) { vb.x = vbIni.x - dx * s; vb.y = vbIni.y - dy * s; limitar(); aplicarVB(); }
  });
  const fim = ev => {
    if (pontos.has(ev.pointerId) && !arrastou && pontos.size === 1) {
      const alvo = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.("#mapa [data-id]");
      if (alvo) {
        // no celular, o 1º toque mostra os números; o 2º toque no mesmo lugar abre
        if (ev.pointerType === "touch" && $("tip").dataset.id !== alvo.dataset.id) { realcar(alvo.dataset.id, false); $("tip").dataset.id = alvo.dataset.id; }
        else clicar(alvo.dataset.id, false);
      }
    }
    pontos.delete(ev.pointerId);
    if (pontos.size === 1) { const [p] = pontos.values(); ini = { x: p.clientX, y: p.clientY }; vbIni = { ...vb }; distIni = 0; }
  };
  svg.addEventListener("pointerup", fim);
  svg.addEventListener("pointercancel", ev => pontos.delete(ev.pointerId));
  svg.addEventListener("mouseleave", () => { $("tip").hidden = true; document.querySelectorAll("#mapa .hov").forEach(p => p.classList.remove("hov")); });
  $("zoomMais").onclick = () => zoom(1 / 1.5);
  $("zoomMenos").onclick = () => zoom(1.5);
  $("zoomReset").onclick = () => { vb = { ...baseVB }; aplicarVB(); };
})();

// ---------- controles ----------
document.querySelectorAll(".mapTabs button").forEach(x => x.classList.toggle("on", x.dataset.m === modo));
document.querySelectorAll(".mapTabs button").forEach(bt => bt.onclick = () => {
  modo = bt.dataset.m;
  document.querySelectorAll(".mapTabs button").forEach(x => x.classList.toggle("on", x === bt));
  desenhar(false);
});
$("busca").oninput = ev => { busca = ev.target.value; lista(); };
window.addEventListener("hashchange", () => { status(""); rota(); });

rota();
carregarBrasil().then(() => { if (nivel === "BR") mostrarBrasil(); });
