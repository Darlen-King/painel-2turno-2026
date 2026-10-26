// Mapa detalhado: Brasil → estado → cidades (quem cresceu do 1º para o 2º turno)
const BASE = "https://resultados.tse.jus.br/oficial";
const ANO = "2026", T2 = "6258", T1 = "6257";
const UFS = ["ac","al","am","ap","ba","ce","df","es","go","ma","mg","ms","mt","pa","pb","pe","pi","pr","rj","rn","ro","rr","rs","sc","se","sp","to"];
const NOMES = { "13": "LULA", "22": "FLAVIO BOLSONARO" };
const LIM = { cresc: 15, venc: 30 };

const $ = id => document.getElementById(id);
const pad = c => String(c).padStart(6, "0");
const num = s => typeof s === "number" ? s : parseFloat(String(s ?? "0").replace(/\./g, "").replace(",", "."));
const pctNum = s => typeof s === "number" ? s : parseFloat(String(s ?? "0").replace(",", "."));
const fmt = n => Number(n || 0).toLocaleString("pt-BR");
const pctFmt = (n, d = 2) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
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
  return {
    g13, g22, saldo: g22 - g13, quemCresc: g22 - g13 >= 0 ? "22" : "13",
    lid, dp: Math.abs(it.t2["22"][1] - it.t2["13"][1]), dv: Math.abs(it.t2["22"][0] - it.t2["13"][0])
  };
}
const intens = (v, lim) => 0.28 + Math.min(Math.abs(v), lim) / lim * 0.72;
function pintura(it) {
  const m = calc(it);
  if (!m) return { fill: "var(--line)", op: 1 };
  return modo === "cresc" ? { fill: corNum(m.quemCresc), op: intens(m.saldo, LIM.cresc) }
                          : { fill: corNum(m.lid), op: intens(m.dp, LIM.venc) };
}

// ---------- estado da página ----------
let modo = "cresc";            // cresc | venc
let nivel = "BR";              // BR ou sigla da UF
let itens = [];                // [{id, nm, d, cx, cy, t1, t2}]
let ordem = "saldo", busca = "", selId = null;
const dadosUF = {};            // UF -> {t1, t2}
const cacheMun = {};           // UF -> itens
let configMun = null;          // config de municípios do TSE

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
  const P = ([x, y]) => [((x * K - minx) * S).toFixed(1), ((-y - miny) * S).toFixed(1)];
  const shapes = polys.map(arr => {
    let d = "", area = 0, cx = 0, cy = 0;
    arr.forEach(p => p.forEach((anel, i) => {
      const pts = anel.map(P);
      d += "M" + pts.map(q => q.join(" ")).join("L") + "Z";
      if (i === 0) { // centro aproximado pelo maior anel
        let a = 0, sx = 0, sy = 0;
        for (let k = 0; k < pts.length - 1; k++) {
          const x0 = +pts[k][0], y0 = +pts[k][1], x1 = +pts[k + 1][0], y1 = +pts[k + 1][1], c = x0 * y1 - x1 * y0;
          a += c; sx += (x0 + x1) * c; sy += (y0 + y1) * c;
        }
        if (Math.abs(a) > Math.abs(area)) { area = a; cx = sx / (3 * a); cy = sy / (3 * a); }
      }
    }));
    return { d, cx, cy };
  });
  return { shapes, vb: { x: 0, y: 0, w: largura, h: H } };
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

// resultados por cidade: usa o arquivo pronto do repositório (data/mun/uf.json) ou busca no TSE
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

// ---------- navegação ----------
async function irBrasil() {
  nivel = "BR"; selId = null; busca = ""; $("busca").value = "";
  const feats = Object.entries(MAPA_UF);
  itens = feats.map(([uf, m]) => ({ id: uf, nm: m.nome, d: m.d, cx: m.cx, cy: m.cy, ...(dadosUF[uf] || {}) }));
  const [, , w, h] = MAPA_VIEWBOX.split(" ").map(Number);
  baseVB = { x: 0, y: 0, w, h };
  desenhar(true);
}

async function irUF(uf) {
  nivel = uf; selId = null; busca = ""; $("busca").value = "";
  desenhar(true); // mostra o nível vazio enquanto carrega
  try {
    if (!cacheMun[uf]) {
      status(`Carregando mapa de ${MAPA_UF[uf]?.nome || uf}…`);
      const [geo, res] = await Promise.all([geoUF(uf), resultadosMun(uf)]);
      const porIBGE = {}; res.forEach(m => porIBGE[String(m.cdi)] = m);
      const feats = geo.features || [];
      const { shapes, vb } = projetar(feats);
      cacheMun[uf] = {
        vb, itens: feats.map((f, i) => {
          const cod = String(f.properties?.codarea || f.properties?.id || ""), m = porIBGE[cod] || {};
          return { id: cod, nm: m.nm || cod, ...shapes[i], t1: m.t1, t2: m.t2, cdTse: m.cd };
        })
      };
      status("");
    }
    if (nivel !== uf) return;
    itens = cacheMun[uf].itens; baseVB = cacheMun[uf].vb;
    desenhar(true);
  } catch (e) {
    status("Não consegui carregar as cidades: " + e.message);
  }
}

// ---------- desenho ----------
let baseVB = { x: 0, y: 0, w: 600, h: 618 }, vb = { ...baseVB };
function aplicarVB() { $("mapa").setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`); }

function desenhar(resetZoom) {
  const svg = $("mapa");
  if (resetZoom) { vb = { ...baseVB }; aplicarVB(); }
  const br = nivel === "BR";
  svg.innerHTML = itens.map(it => {
    const p = pintura(it);
    return `<path data-id="${it.id}" d="${it.d}" style="fill:${p.fill};fill-opacity:${p.op}" class="${it.id === selId ? "sel" : ""}"/>`;
  }).join("") + (br ? itens.map(it => `<text x="${it.cx}" y="${it.cy}" class="maplbl ${["DF","SE","AL","RN","PB","ES","RJ"].includes(it.id) ? "sm" : ""}">${it.id}</text>`).join("") : "");
  svg.classList.toggle("muni", !br);
  $("trilha").innerHTML = br ? `<b>Brasil</b>` :
    `<a href="#" id="voltarBR">Brasil</a> › <b>${MAPA_UF[nivel]?.nome || nivel}</b>`;
  if (!br) $("voltarBR").onclick = e => { e.preventDefault(); location.hash = ""; };
  $("dica").textContent = br ? "Clique num estado para ver as cidades · role a roda do mouse ou use + e − para dar zoom"
                             : "Passe o mouse ou toque numa cidade · arraste para mover · role ou use + e − para dar zoom";
  lista(); placar(); legenda();
}

function placar() {
  const c = { "13": 0, "22": 0 }; let sem = 0;
  itens.forEach(it => { const m = calc(it); if (!m) { sem++; return; } c[modo === "cresc" ? m.quemCresc : m.lid]++; });
  const unid = nivel === "BR" ? "estados" : "cidades";
  $("placar").innerHTML = ["13", "22"].map(n =>
    `<span><i style="background:${corNum(n)}"></i>${NOMES[n]}: <b>${c[n]}</b> ${unid}${modo === "cresc" ? " onde cresceu mais" : ""}</span>`).join("") +
    (sem && itens.length && nivel !== "BR" ? `<span class="mini">${sem} sem dados</span>` : "");
}

function legenda() {
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
  const cresc = modo === "cresc";
  const unid = nivel === "BR" ? "Estado" : "Cidade";
  $("listaTit").textContent = nivel === "BR" ? "Estados" : `Cidades de ${MAPA_UF[nivel]?.nome || nivel} (${itens.length})`;
  $("busca").hidden = nivel === "BR";
  $("lHead").innerHTML = `<tr><th data-o="nome">${unid}</th>
    <th class="r" style="color:var(--a)">${primeiro("13")}<div class="mini">${cresc ? "1º → 2º" : "2º turno"}</div></th>
    <th class="r" style="color:var(--b-txt)">${primeiro("22")}<div class="mini">${cresc ? "1º → 2º" : "2º turno"}</div></th>
    <th class="r" data-o="saldo">${cresc ? "Cresceu mais" : "Vantagem"}</th></tr>`;
  $("lHead").querySelectorAll("[data-o]").forEach(th => { th.classList.toggle("on", th.dataset.o === ordem); th.onclick = () => { ordem = th.dataset.o; lista(); }; });
  const q = semAcento(busca);
  const val = it => { const m = calc(it); return !m ? -1e9 : cresc ? m.saldo : (m.lid === "22" ? m.dp : -m.dp); };
  const vis = itens.filter(it => !q || semAcento(it.nm).includes(q))
    .sort((a, b) => ordem === "nome" ? a.nm.localeCompare(b.nm, "pt-BR") : val(b) - val(a));
  $("lBody").innerHTML = vis.map(it => {
    const m = calc(it);
    if (!m) return `<tr data-id="${it.id}"><td>${nomeItem(it)}</td><td colspan="3" class="r mini">sem dados</td></tr>`;
    const cel = n => cresc
      ? `<span class="t12">${pctFmt(it.t1[n][1], 1)} → ${pctFmt(it.t2[n][1], 1)}</span><div class="mini" style="color:${txtNum(n)}">${sinal(it.t2[n][1] - it.t1[n][1])} p.p.</div>`
      : `<span class="${m.lid === n ? "win" : ""}">${pctFmt(it.t2[n][1], 1)}%</span><div class="mini">${fmt(it.t2[n][0])}</div>`;
    const quem = cresc ? m.quemCresc : m.lid, v = cresc ? Math.abs(m.saldo) : m.dp;
    return `<tr data-id="${it.id}" class="${it.id === selId ? "sel" : ""}"><td>${nomeItem(it)}</td><td class="r">${cel("13")}</td><td class="r">${cel("22")}</td>
      <td class="r"><span class="chip" style="--c:${corNum(quem)};--t:${txtNum(quem)}">${primeiro(quem)} +${pctFmt(v, 1)}</span></td></tr>`;
  }).join("") || `<tr><td colspan="4" class="mini">Nada encontrado.</td></tr>`;
  $("lBody").querySelectorAll("tr[data-id]").forEach(tr => {
    tr.onmouseenter = () => realcar(tr.dataset.id);
    tr.onclick = () => clicar(tr.dataset.id, true);
  });
}
const nomeItem = it => nivel === "BR" ? `<b>${it.id}</b> <span class="ufnm">${it.nm}</span>` : `<b>${it.nm}</b>`;

function dicaHTML(it) {
  const m = calc(it);
  if (!m) return `<b>${it.nm}</b><br><span class="mini">sem dados</span>`;
  const linha = n => `<span style="color:${txtNum(n)}">${NOMES[n]}: ${pctFmt(it.t1[n][1])}% → <b>${pctFmt(it.t2[n][1])}%</b> (${sinal(it.t2[n][1] - it.t1[n][1], 2)} p.p.)</span>`;
  return `<b>${it.nm}</b> <span class="mini">1º → 2º turno</span><br>${linha("13")}<br>${linha("22")}<br>
    <b style="color:${txtNum(m.quemCresc)}">${NOMES[m.quemCresc]} cresceu ${pctFmt(Math.abs(m.saldo), 2)} p.p. a mais</b><br>
    <span class="mini">2º turno: ${NOMES[m.lid]} vence por ${fmt(m.dv)} votos (${pctFmt(m.dp, 2)} p.p.) · apurado ${pctFmt(it.t2.pst, 1)}%</span>`;
}
function realcar(id) {
  const it = itens.find(x => x.id === id), tip = $("tip");
  document.querySelectorAll("#mapa path").forEach(p => p.classList.toggle("hov", p.dataset.id === id));
  if (!it) { tip.hidden = true; return; }
  tip.hidden = false; tip.innerHTML = dicaHTML(it);
}
function clicar(id, daLista) {
  if (nivel === "BR") { location.hash = id; return; }
  selId = selId === id ? null : id;
  document.querySelectorAll("#mapa path").forEach(p => p.classList.toggle("sel", p.dataset.id === selId));
  document.querySelectorAll("#lBody tr").forEach(tr => tr.classList.toggle("sel", tr.dataset.id === selId));
  realcar(id);
  if (selId && daLista) { // aproxima na cidade escolhida pela lista
    const p = document.querySelector(`#mapa path[data-id="${id}"]`);
    if (p) { const b = p.getBBox(), w = Math.max(b.width, b.height) * 4; vb = { x: b.x + b.width / 2 - w / 2, y: b.y + b.height / 2 - w * baseVB.h / baseVB.w / 2, w, h: w * baseVB.h / baseVB.w }; limitar(); aplicarVB(); }
  }
  if (selId && !daLista) document.querySelector(`#lBody tr[data-id="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
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
function zoom(f, cx, cy) { // f < 1 aproxima
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
      const alvo = ev.target.closest?.("path");
      if (alvo) realcar(alvo.dataset.id);
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
      const alvo = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.("#mapa path");
      if (alvo) clicar(alvo.dataset.id, false);
    }
    pontos.delete(ev.pointerId);
    if (pontos.size === 1) { const [p] = pontos.values(); ini = { x: p.clientX, y: p.clientY }; vbIni = { ...vb }; distIni = 0; }
  };
  svg.addEventListener("pointerup", fim);
  svg.addEventListener("pointercancel", ev => pontos.delete(ev.pointerId));
  svg.addEventListener("mouseleave", () => { $("tip").hidden = true; document.querySelectorAll("#mapa path.hov").forEach(p => p.classList.remove("hov")); });
  $("zoomMais").onclick = () => zoom(1 / 1.5);
  $("zoomMenos").onclick = () => zoom(1.5);
  $("zoomReset").onclick = () => { vb = { ...baseVB }; aplicarVB(); };
})();

// ---------- controles ----------
document.querySelectorAll(".mapTabs button").forEach(bt => bt.onclick = () => {
  modo = bt.dataset.m;
  document.querySelectorAll(".mapTabs button").forEach(x => x.classList.toggle("on", x === bt));
  desenhar(false);
});
$("busca").oninput = ev => { busca = ev.target.value; lista(); };
function rota() {
  const uf = location.hash.replace("#", "").toUpperCase();
  if (uf && MAPA_UF[uf]) irUF(uf); else irBrasil();
}
window.addEventListener("hashchange", rota);

rota();
carregarBrasil().then(() => { if (nivel === "BR") irBrasil(); });
