const BASE = "https://resultados.tse.jus.br/oficial";
const INTERVAL = 10; // segundos
const qs = new URLSearchParams(location.search);
let YEAR = qs.get("ano") || "2026";
let CODE = qs.get("e") || "6258";   // código do link enviado; troque aqui se o TSE usar outro para o 2º turno
let timer = 10, history = [], lastStamp = null, loading = false;

const $ = id => document.getElementById(id);
const fmt = n => Number(n || 0).toLocaleString("pt-BR");
const num = s => typeof s === "number" ? s : parseFloat(String(s || "0").replace(/\./g, "").replace(",", "."));
const pctNum = s => typeof s === "number" ? s : parseFloat(String(s || "0").replace(",", "."));
const pctFmt = (n, d = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const pad = c => String(c).padStart(6, "0");
const urlData = () => `${BASE}/ele${YEAR}/${CODE}/dados/br/br-c0001-e${pad(CODE)}-u.jws`;

// O TSE publica um JWS (header.payload.assinatura); o payload é JSON em base64url
function decodeJws(txt) {
  const t = txt.trim();
  if (t.startsWith("{")) return JSON.parse(t);
  let b = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  const bytes = Uint8Array.from(atob(b), ch => ch.charCodeAt(0));
  return JSON.parse(new TextDecoder("utf-8").decode(bytes));
}

// Converte o formato novo (carg/agr/par/cand, s, e, v) para o formato usado pelo painel
function normalize(j) {
  if (j.cand) return j;
  const cargo = (j.carg || [])[0] || {};
  const cand = [];
  (cargo.agr || []).forEach(ag => (ag.par || []).forEach(p => (p.cand || []).forEach(c =>
    cand.push({ ...c, nm: c.nmu || c.nm, cc: p.sg })
  )));
  const s = j.s || {}, e = j.e || {}, v = j.v || {};
  return {
    cand, dg: j.dg, hg: j.hg, dt: j.dt, ht: j.ht,
    s: s.ts, st: s.st, pst: s.pst,
    vv: v.vv, pvv: v.pvvc, vb: v.vb, pvb: v.pvb, tvn: v.tvn, ptvn: v.ptvn,
    a: e.a, pa: e.pa
  };
}
const urlFoto = sq => `${BASE}/ele${YEAR}/${CODE}/fotos/br/${sq}.jpeg`;

$("cfgCode").value = CODE; $("cfgYear").value = YEAR;
$("cfgApply").onclick = () => { CODE = $("cfgCode").value.trim(); YEAR = $("cfgYear").value.trim(); loadHist(); load(); };
$("refresh").onclick = () => load();

// Tenta descobrir o código do 2º turno de presidente no arquivo de configuração do TSE
async function discover() {
  try {
    const r = await fetch(`${BASE}/comum/config/ele-c.json?_=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    const found = [];
    (function walk(o) {
      if (Array.isArray(o)) return o.forEach(walk);
      if (o && typeof o === "object") {
        if (o.cd && String(o.t) === "2" && /2026|Geral|Federal/i.test(JSON.stringify(o))) found.push(String(o.cd));
        Object.values(o).forEach(walk);
      }
    })(j);
    return found.length ? found[found.length - 1] : null;
  } catch { return null; }
}

async function load() {
  if (loading) return;
  loading = true; timer = INTERVAL;
  $("cfgUrl").textContent = urlData();
  try {
    let r = await fetch(`${urlData()}?_=${Date.now()}`, { cache: "no-store" });
    if (r.status === 403 || r.status === 404) {
      const alt = await discover();
      if (alt && alt !== CODE) { CODE = alt; $("cfgCode").value = CODE; r = await fetch(`${urlData()}?_=${Date.now()}`, { cache: "no-store" }); }
    }
    if (!r.ok) throw new Error(`HTTP ${r.status} ao buscar ${urlData()}`);
    render(normalize(decodeJws(await r.text())));
    if (typeof loadStates === "function") loadStates();
    $("dot").classList.remove("err"); $("err").textContent = "";
  } catch (e) {
    $("dot").classList.add("err");
    $("err").textContent = "Não consegui ler os dados do TSE: " + e.message +
      "\nSe o código da eleição do 2º turno for outro, troque no campo acima (ele aparece na URL do site do TSE, depois de /eleicao/).";
  } finally { loading = false; }
}

function render(d) {
  const cands = (d.cand || []).slice().sort((x, y) => num(y.vap) - num(x.vap));
  if (cands.length < 2) throw new Error("resposta sem os dois candidatos");
  // ordem e cor fixas pelo número do candidato (13 = vermelho, 22 = azul); o 'seq' do TSE muda conforme quem lidera
  const sorted = cands.slice().sort((x, y) => (x.n === "13" ? 0 : 1) - (y.n === "13" ? 0 : 1));
  const colors = ["var(--a)", "var(--b)"];
  const byNum = {}; sorted.forEach(c => byNum[c.n] = c.n === "13" ? colors[0] : colors[1]);
  const byTxt = {}; sorted.forEach(c => byTxt[c.n] = c.n === "13" ? "var(--a)" : "var(--b-txt)");

  $("cands").innerHTML = sorted.slice(0, 2).map(c => {
    const lead = c.n === cands[0].n;
    return `<div class="card cand" style="--c:${byNum[c.n]};--ct:${byTxt[c.n]}">
      <img src="${urlFoto(c.sqcand)}" alt="" onerror="this.style.visibility='hidden'">
      <div><div class="pt">${c.cc || ""} – ${c.n}</div>
        <div class="nm">${c.nm}</div>
        ${lead ? `<span class="lead-tag">${String(c.e) === "s" ? "ELEITO" : "À FRENTE"}</span>` : ""}</div>
      <div class="right"><div class="pct">${pctFmt(pctNum(c.pvap))}%</div><div class="votes">${fmt(num(c.vap))} votos</div></div>
    </div>`;
  }).join("");

  const [a, b] = cands;
  const dv = num(a.vap) - num(b.vap);
  const dp = pctNum(a.pvap) - pctNum(b.pvap);
  $("diffWho").innerHTML = `<b style="color:${byTxt[a.n]}">${a.nm}</b> está à frente de <b style="color:${byTxt[b.n]}">${b.nm}</b>`;
  $("diffVotes").textContent = fmt(dv);
  $("diffPct").textContent = pctFmt(dp) + " p.p.";
  const first = sorted[0], second = sorted[1];
  $("barA").style.cssText = `width:${pctNum(first.pvap)}%;background:${byNum[first.n]}`;
  $("barB").style.cssText = `width:${pctNum(second.pvap)}%;background:${byNum[second.n]}`;

  const pst = pctNum(d.pst);
  $("secPct").textContent = pctFmt(pst) + "%";
  $("sec").textContent = `${fmt(num(d.st))} de ${fmt(num(d.s))}`;
  $("secBar").style.width = pst + "%";
  $("vv").textContent = fmt(num(d.vv)); $("vvp").textContent = d.pvv ? d.pvv + "% do comparecimento" : "";
  $("vb").textContent = fmt(num(d.vb)); $("vbp").textContent = d.pvb ? d.pvb + "%" : "";
  $("vn").textContent = fmt(num(d.tvn ?? d.vn)); $("vnp").textContent = (d.ptvn ?? d.pvn) ? (d.ptvn ?? d.pvn) + "%" : "";
  $("ab").textContent = fmt(num(d.a)); $("abp").textContent = d.pa ? d.pa + "% do eleitorado" : "";

  const stamp = `${d.dg || d.dt || ""} ${d.hg || d.ht || ""}`.trim();
  $("tseTime").textContent = `Última totalização TSE: ${stamp || "—"} · consultado às ${new Date().toLocaleTimeString("pt-BR")}`;

  cands.forEach(c => CAND_NM[c.n] = c.nm);
  if (stamp !== lastStamp) {
    const prev = history[history.length - 1];
    lastStamp = stamp;
    if (addHist([{ t: stamp, v: dv, leader: a.n, pst }]) && prev && prev.leader === a.n) {
      const delta = dv - prev.v;
      if (delta) $("diffVotes").insertAdjacentHTML("beforeend",
        `<span class="chg ${delta > 0 ? "up" : "down"}">${delta > 0 ? "▲" : "▼"} ${fmt(Math.abs(delta))}</span>`);
    }
  }
  drawChart();
}

// ---------- Histórico da diferença (fica salvo neste navegador) ----------
let CAND_NM = { "13": "LULA", "22": "FLAVIO BOLSONARO" };
const histKey = () => `painel-hist-${YEAR}-${CODE}`;
const tsNum = t => { const m = String(t).match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+):(\d+)/); return m ? Date.UTC(m[3], m[2] - 1, m[1], m[4], m[5], m[6]) : 0; };

// junta leituras novas sem repetir (chave = horário da totalização do TSE); devolve true se entrou algo novo
function addHist(itens) {
  const vistos = new Set(history.map(h => h.t));
  let novos = 0;
  (itens || []).forEach(h => {
    if (!h || !h.t || vistos.has(h.t) || typeof h.v !== "number") return;
    vistos.add(h.t); novos++;
    history.push({ t: h.t, v: h.v, leader: String(h.leader || ""), pst: h.pst });
  });
  if (novos) {
    history.sort((x, y) => tsNum(x.t) - tsNum(y.t));
    try { localStorage.setItem(histKey(), JSON.stringify(history)); } catch {}
  }
  return novos > 0;
}
function loadHist() {
  history = [];
  try { addHist(JSON.parse(localStorage.getItem(histKey()) || "[]")); } catch {}
  if (Array.isArray(window.HIST_INICIAL)) addHist(window.HIST_INICIAL);
  lastStamp = history.length ? history[history.length - 1].t : null;
  drawChart();
}

// valor com sinal: acima de zero = 22 à frente, abaixo = 13 à frente
const signed = h => h.leader === "13" ? -h.v : h.v;

const fmtCurto = v => { const a = Math.abs(v);
  return a >= 1e6 ? (a / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: a >= 1e7 ? 0 : 1 }) + " mi"
       : a >= 1e3 ? Math.round(a / 1e3).toLocaleString("pt-BR") + " mil" : String(a); };
const horaDe = t => String(t).split(" ")[1]?.slice(0, 5) || t;
let chartPts = [];

function drawChart() {
  const svg = $("chart");
  if (history.length < 2) {
    svg.innerHTML = ""; chartPts = [];
    $("chartNote").textContent = history.length ? "1 leitura salva — o gráfico aparece a partir da 2ª." : "O gráfico vai se formando a cada atualização com dado novo.";
    return;
  }
  const W = Math.max(svg.clientWidth || 600, 300), H = 260, L = 78, R = 14, T = 14, B = 30;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const n22 = CAND_NM["22"] || "22", n13 = CAND_NM["13"] || "13";
  const vals = history.map(signed), ts = history.map(h => tsNum(h.t));
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  // passo "redondo" para o eixo Y
  const bruto = (hi - lo) / 5 || 1, p10 = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map(m => m * p10).find(m => m >= bruto);
  lo = Math.floor(lo / passo) * passo; hi = Math.ceil(hi / passo) * passo;
  const t0 = ts[0], t1 = ts[ts.length - 1] || t0 + 1;
  const x = t => L + (t - t0) / ((t1 - t0) || 1) * (W - L - R);
  const y = v => T + (hi - v) / ((hi - lo) || 1) * (H - T - B);
  const cor = h => h.leader === "13" ? "var(--a)" : "var(--b)";
  let g = "";
  // grade + valores do eixo Y
  for (let v = lo; v <= hi + 1e-9; v += passo) {
    const lab = v === 0 ? "empate" : `${v > 0 ? n22.split(" ")[0] : n13.split(" ")[0]} +${fmtCurto(v)}`;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? "zero" : "grid"}"/>` +
         `<text x="${L - 6}" y="${y(v)}" class="ylab" style="fill:${v > 0 ? "var(--b-txt)" : v < 0 ? "var(--a)" : "var(--muted)"}">${lab}</text>`;
  }
  // horários do eixo X (marcas a cada 10/15/30/60 min)
  const minutos = (t1 - t0) / 60000, alvo = Math.max(3, Math.floor((W - L) / 80));
  const passoMin = [5, 10, 15, 30, 60, 90, 120, 240].find(m => minutos / m <= alvo) || 480;
  for (let t = Math.ceil(t0 / (passoMin * 60000)) * passoMin * 60000; t <= t1; t += passoMin * 60000) {
    const d = new Date(t), lab = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    g += `<line x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${H - B}" class="grid"/><text x="${x(t)}" y="${H - B + 18}" class="xlab">${lab}</text>`;
  }
  chartPts = history.map((h, i) => ({ h, x: x(ts[i]), y: y(vals[i]) }));
  // linha (interrompida quando há buraco de mais de 15 min sem leitura)
  let path = "";
  chartPts.forEach((p, i) => { path += (i && ts[i] - ts[i - 1] <= 15 * 60000 ? "L" : "M") + p.x.toFixed(1) + " " + p.y.toFixed(1); });
  g += `<path d="${path}" fill="none" stroke="var(--muted)" stroke-opacity=".55" stroke-width="2"/>`;
  g += chartPts.map(p => `<circle cx="${p.x}" cy="${p.y}" r="${chartPts.length > 120 ? 2.2 : 3}" fill="${cor(p.h)}"/>`).join("");
  // destaque do último valor
  const u = chartPts[chartPts.length - 1];
  g += `<circle cx="${u.x}" cy="${u.y}" r="5" fill="${cor(u.h)}" stroke="var(--card)" stroke-width="2"/>` +
       `<text x="${u.x - 8}" y="${u.y - 10}" class="ultimo" style="fill:${u.h.leader === "13" ? "var(--a)" : "var(--b-txt)"}">${fmt(u.h.v)} · ${horaDe(u.h.t)}</text>`;
  g += `<line id="chHover" y1="${T}" y2="${H - B}" class="hover" style="display:none"/>`;
  svg.innerHTML = g;
  $("chartNote").innerHTML = `${history.length} leituras · de ${horaDe(history[0].t)} a ${horaDe(history[history.length - 1].t)} (${history[0].t.split(" ")[0]}) · ` +
    `acima da linha <i>empate</i>: <b style="color:var(--b-txt)">${n22}</b> à frente · abaixo: <b style="color:var(--a)">${n13}</b> à frente · passe o mouse ou toque no gráfico para ver cada leitura`;
}

// dica com horário e valor ao passar o mouse / tocar
function chartHover(ev) {
  if (!chartPts.length) return;
  const svg = $("chart"), r = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal, px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
  const sx = px * vb.width / r.width;
  let best = chartPts[0];
  chartPts.forEach(p => { if (Math.abs(p.x - sx) < Math.abs(best.x - sx)) best = p; });
  const h = best.h, tip = $("chartTip"), ln = document.getElementById("chHover");
  if (ln) { ln.setAttribute("x1", best.x); ln.setAttribute("x2", best.x); ln.style.display = ""; }
  tip.hidden = false;
  tip.innerHTML = `<b>${horaDe(h.t)}</b> <span class="mini">${h.t.split(" ")[0]}</span><br>` +
    `<span style="color:${h.leader === "13" ? "var(--a)" : "var(--b-txt)"}"><b>${CAND_NM[h.leader] || h.leader}</b> à frente</span><br>` +
    `por <b>${fmt(h.v)}</b> votos<br><span class="mini">${pctFmt(Number(h.pst) || 0)}% das seções apuradas</span>`;
  const left = best.x * r.width / vb.width;
  tip.style.left = Math.min(Math.max(left - tip.offsetWidth / 2, 0), r.width - tip.offsetWidth) + "px";
}
$("chart").addEventListener("mousemove", chartHover);
$("chart").addEventListener("touchstart", chartHover, { passive: true });
$("chart").addEventListener("touchmove", chartHover, { passive: true });
$("chart").addEventListener("mouseleave", () => { $("chartTip").hidden = true; const l = document.getElementById("chHover"); if (l) l.style.display = "none"; });
let resizeT; window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(drawChart, 150); });

// botões de copiar / importar histórico
$("histCopy").onclick = async () => {
  const txt = JSON.stringify(history);
  try { await navigator.clipboard.writeText(txt); $("histMsg").textContent = `Copiado: ${history.length} leituras.`; }
  catch { $("histBox").hidden = false; $("histTxt").value = txt; $("histTxt").select(); $("histMsg").textContent = "Selecione o texto e copie (Cmd+C)."; }
};
$("histImport").onclick = () => { $("histBox").hidden = !$("histBox").hidden; $("histTxt").value = ""; $("histMsg").textContent = ""; };
$("histMerge").onclick = () => {
  try {
    const antes = history.length;
    addHist(JSON.parse($("histTxt").value.trim()));
    lastStamp = history[history.length - 1]?.t || lastStamp;
    drawChart();
    $("histMsg").textContent = `Importado: ${history.length - antes} leituras novas (total ${history.length}).`;
    $("histBox").hidden = true;
  } catch (e) { $("histMsg").textContent = "Texto inválido — cole exatamente o que foi copiado."; }
};

// histórico coletado automaticamente pelo GitHub Actions (historico.json no repositório)
function urlHistRemoto() {
  const h = location.hostname, partes = location.pathname.split("/").filter(Boolean);
  if (h.endsWith(".github.io") && partes.length) // lê direto do repositório (mais atualizado que o site)
    return `https://raw.githubusercontent.com/${h.split(".")[0]}/${partes[0]}/main/historico.json`;
  return "historico.json";
}
async function loadHistRemoto() {
  try {
    const r = await fetch(`${urlHistRemoto()}?_=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    if (addHist(await r.json())) drawChart();
  } catch {}
}

loadHist();
loadHistRemoto();
setInterval(loadHistRemoto, 120000);

setInterval(() => {
  timer--;
  $("countdown").textContent = `próxima atualização em ${Math.max(timer, 0)}s`;
  if (timer <= 0) load();
}, 1000);
load();
