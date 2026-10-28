// Resultado por estado: lista (esquerda) + mapa (direita)
// Mapa 1 = quem vence no 2º turno · Mapa 2 = quem cresceu mais do 1º para o 2º turno
// Mapa 3 = quem perdeu mais votos do 1º para o 2º turno
const UFS = ["ac","al","am","ap","ba","ce","df","es","go","ma","mg","ms","mt","pa","pb","pe","pi","pr","rj","rn","ro","rr","rs","sc","se","sp","to","zz"];
const UF_NOME = { ZZ: "Exterior" };
Object.keys(MAPA_UF).forEach(k => UF_NOME[k] = MAPA_UF[k].nome);

const estados = {};          // uf -> dados do 2º turno
const turno1 = {};           // uf -> { "13": {vap,pvap}, "22": {...} } do 1º turno
let CODE_T1 = "6257";        // código do 1º turno (confirmado pela configuração do TSE quando possível)
let ufSort = "uf";           // uf | margem | apuracao
let ufSel = null;            // UF destacada
let modoMapa = "venc";       // venc (Mapa 1) | cresc (Mapa 2) | perda (Mapa 3)
let loadingStates = false, t1Carregado = false;

const corSeq = seq => String(seq) === "1" ? "var(--a)" : "var(--b)";
const corTxt = seq => String(seq) === "1" ? "var(--a)" : "var(--b-txt)";
const corNum = n => n === "13" ? "var(--a)" : "var(--b)";
const txtNum = n => n === "13" ? "var(--a)" : "var(--b-txt)";
const sinal = (v, d = 1) => (v > 0 ? "+" : v < 0 ? "−" : "") + pctFmt(Math.abs(v), d);
const sinalV = v => (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v));  // votos com sinal
const LIM_VENC = 30, LIM_CRESC = 15;  // p.p. em que a cor fica no máximo
const LIM_PERDA = 10;                 // % dos votos do 1º turno em que a cor fica no máximo

function candidatosDe(j) {
  const cand = [];
  ((j.carg || [])[0]?.agr || []).forEach(ag => (ag.par || []).forEach(p => (p.cand || []).forEach(c =>
    cand.push({ n: c.n, seq: c.n === "13" ? "1" : "2", nm: c.nmu || c.nm, vap: num(c.vap), pvap: pctNum(c.pvap) })
  )));
  return cand;
}

function resumoUF(j) {
  const cand = candidatosDe(j).filter(c => c.n === "13" || c.n === "22");
  cand.sort((x, y) => Number(x.seq) - Number(y.seq));
  const lid = cand.slice().sort((x, y) => y.vap - x.vap);
  return {
    cand, lider: lid[0], dv: (lid[0]?.vap || 0) - (lid[1]?.vap || 0),
    dp: (lid[0]?.pvap || 0) - (lid[1]?.pvap || 0),
    pst: pctNum(j.s?.pst), hg: j.hg
  };
}

// crescimento do 1º para o 2º turno, em pontos percentuais dos votos válidos
function crescimento(uf) {
  const e = estados[uf], t = turno1[uf];
  if (!e || !t || !t["13"] || !t["22"] || !e.pst) return null;
  const c = {}; e.cand.forEach(x => c[x.n] = x);
  if (!c["13"] || !c["22"]) return null;
  const g13 = c["13"].pvap - t["13"].pvap, g22 = c["22"].pvap - t["22"].pvap;
  const v13 = c["13"].vap - t["13"].vap, v22 = c["22"].vap - t["22"].vap;   // votos ganhos (+) ou perdidos (−)
  return { g13, g22, v13, v22, saldo: g22 - g13, p1: t, p2: c }; // saldo > 0: Flávio cresceu mais
}

// Mapa 3: quem perdeu mais votos do 1º para o 2º turno (em número de votos)
function perda(uf) {
  const g = crescimento(uf);
  if (!g) return null;
  const r13 = g.p1["13"].vap ? g.v13 / g.p1["13"].vap * 100 : 0;   // variação em % dos votos do 1º turno
  const r22 = g.p1["22"].vap ? g.v22 / g.p1["22"].vap * 100 : 0;
  let quem = null;
  if (g.v13 < 0 || g.v22 < 0) quem = g.v13 < g.v22 ? "13" : "22";
  return { ...g, r13, r22, quem,
    perdeu: quem ? -(quem === "13" ? g.v13 : g.v22) : 0,
    rq: quem ? -(quem === "13" ? r13 : r22) : 0 };
}

async function descobrirT1() {
  try {
    const r = await fetch(`${BASE}/comum/config/ele-c.jws?_=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const j = decodeJws(await r.text());
    (j.pl || []).forEach(pl => (pl.e || []).forEach(e => { if (String(e.cdt2) === String(CODE)) CODE_T1 = String(e.cd); }));
  } catch {}
}

async function loadTurno1() {
  await descobrirT1();
  await Promise.allSettled(UFS.map(async uf => {
    const r = await fetch(`${BASE}/ele${YEAR}/${CODE_T1}/dados/${uf}/${uf}-c0001-e${pad(CODE_T1)}-u.jws`);
    if (!r.ok) throw new Error(r.status);
    const o = {};
    candidatosDe(decodeJws(await r.text())).forEach(c => { if (c.n === "13" || c.n === "22") o[c.n] = c; });
    turno1[uf.toUpperCase()] = o;
  }));
  t1Carregado = Object.keys(turno1).length > 0;
  renderStates();
}

async function loadStates() {
  if (loadingStates) return;
  loadingStates = true;
  try {
    const res = await Promise.allSettled(UFS.map(async uf => {
      const url = `${BASE}/ele${YEAR}/${CODE}/dados/${uf}/${uf}-c0001-e${pad(CODE)}-u.jws?_=${Date.now()}`;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      estados[uf.toUpperCase()] = resumoUF(decodeJws(await r.text()));
    }));
    const falhas = res.filter(r => r.status === "rejected").length;
    $("ufNote").textContent = falhas >= UFS.length ? "Não consegui ler os dados por estado." :
      `Atualizado às ${new Date().toLocaleTimeString("pt-BR")}` + (falhas > 1 ? ` · ${falhas} estados sem dados` : "") +
      (modoMapa !== "venc" ? ` · 1º turno: eleição ${CODE_T1}` : "");
    renderStates();
  } finally { loadingStates = false; }
}

const intensidade = (v, lim) => 0.28 + Math.min(Math.abs(v), lim) / lim * 0.72;

function renderStates() {
  const ufs = Object.keys(estados);
  if (!ufs.length) return;
  const c1 = { n: "13", seq: "1", nm: CAND_NM["13"] || "LULA" }, c2 = { n: "22", seq: "2", nm: CAND_NM["22"] || "FLAVIO BOLSONARO" };
  const cresc = modoMapa === "cresc", perd = modoMapa === "perda", comp = cresc || perd;

  // cabeçalho da tabela
  $("ufHead").innerHTML = `<tr>
    <th data-s="uf">UF</th>
    <th class="r" style="color:${corTxt(c1.seq)}">${c1.nm}${comp ? "<div class='mini'>1º → 2º turno</div>" : ""}</th>
    <th class="r" style="color:${corTxt(c2.seq)}">${c2.nm}${comp ? "<div class='mini'>1º → 2º turno</div>" : ""}</th>
    <th class="r" data-s="margem">${cresc ? "Cresceu mais" : perd ? "Perdeu mais" : "Diferença"}</th>
    <th class="r" data-s="apuracao">Apurado</th></tr>`;
  $("ufHead").querySelectorAll("[data-s]").forEach(th => {
    th.classList.toggle("on", th.dataset.s === ufSort);
    th.onclick = () => { ufSort = th.dataset.s; renderStates(); };
  });

  const chave = uf => cresc ? (crescimento(uf)?.saldo ?? -999) : perd ? (perda(uf)?.perdeu ?? -1) : estados[uf].dp;
  const ordem = ufs.slice().sort((a, b) =>
    ufSort === "margem" ? chave(b) - chave(a) :
    ufSort === "apuracao" ? estados[b].pst - estados[a].pst :
    (a === "ZZ") - (b === "ZZ") || a.localeCompare(b));

  $("ufBody").innerHTML = ordem.map(uf => {
    const e = estados[uf], a = e.cand[0], b = e.cand[1];
    const vazio = !e.pst && !(a?.vap || b?.vap);
    let c2col, c3col, c4col;
    if (cresc) {
      const g = crescimento(uf);
      const cel = (n, x) => g ? `<span class="t12">${pctFmt(g.p1[n].pvap, 1)} → ${pctFmt(g.p2[n].pvap, 1)}</span><div class="mini" style="color:${txtNum(n)}">${sinal(x)} p.p.</div><div class="mini">${sinalV(g["v" + n])} votos</div>` : "—";
      c2col = cel("13", g?.g13); c3col = cel("22", g?.g22);
      const quem = g ? (g.saldo >= 0 ? "22" : "13") : null;
      c4col = g ? `<span class="chip" style="--c:${corNum(quem)};--t:${txtNum(quem)}">${(CAND_NM[quem] || quem).split(" ")[0]} +${pctFmt(Math.abs(g.saldo), 1)}</span><div class="mini">p.p. a mais</div>` : "<span class='mini'>sem dados</span>";
    } else if (perd) {
      const g = perda(uf);
      const cel = n => g ? `<span class="t12">${fmt(g.p1[n].vap)} → ${fmt(g.p2[n].vap)}</span><div class="mini" style="color:${g["v" + n] < 0 ? txtNum(n) : "var(--muted)"}">${sinalV(g["v" + n])} votos</div><div class="mini">${sinal(g["r" + n])}%</div>` : "—";
      c2col = cel("13"); c3col = cel("22");
      c4col = !g ? "<span class='mini'>sem dados</span>" : g.quem
        ? `<span class="chip" style="--c:${corNum(g.quem)};--t:${txtNum(g.quem)}">${(CAND_NM[g.quem] || g.quem).split(" ")[0]} −${fmt(g.perdeu)}</span><div class="mini">−${pctFmt(g.rq, 1)}%</div>`
        : `<span class="chip" style="--c:var(--muted)">ninguém</span>`;
    } else {
      const cor = vazio ? "var(--muted)" : corSeq(e.lider.seq);
      c2col = a ? pctFmt(a.pvap) + "%" : "—";
      c3col = b ? pctFmt(b.pvap) + "%" : "—";
      c4col = `<span class="chip" style="--c:${cor};--t:${vazio ? cor : corTxt(e.lider.seq)}">${vazio ? "—" : "+" + pctFmt(e.dp, 1) + " p.p."}</span>
        <div class="mini">${vazio ? "" : fmt(e.dv) + " votos"}</div>`;
    }
    return `<tr data-uf="${uf}" class="${uf === ufSel ? "sel" : ""}">
      <td><b>${uf}</b> <span class="ufnm">${UF_NOME[uf] || ""}</span></td>
      <td class="r ${!comp && a && a.vap >= (b?.vap || 0) && !vazio ? "win" : ""}">${c2col}</td>
      <td class="r ${!comp && b && b.vap > (a?.vap || 0) ? "win" : ""}">${c3col}</td>
      <td class="r">${c4col}</td>
      <td class="r">${pctFmt(e.pst, 1)}%<div class="prog"><div style="width:${e.pst}%"></div></div></td>
    </tr>`;
  }).join("");
  $("ufBody").querySelectorAll("tr").forEach(tr => {
    tr.onmouseenter = () => destacar(tr.dataset.uf);
    tr.onclick = () => { ufSel = ufSel === tr.dataset.uf ? null : tr.dataset.uf; renderStates(); };
  });

  // mapa
  Object.keys(MAPA_UF).forEach(uf => {
    const p = document.getElementById("map-" + uf), e = estados[uf];
    let fill = "var(--line)", op = 1;
    if (cresc) {
      const g = crescimento(uf);
      if (g) { fill = corNum(g.saldo >= 0 ? "22" : "13"); op = intensidade(g.saldo, LIM_CRESC); }
    } else if (perd) {
      const g = perda(uf);
      if (g) { if (g.quem) { fill = corNum(g.quem); op = intensidade(g.rq, LIM_PERDA); } else { fill = "var(--muted)"; op = 0.45; } }
    } else if (e && (e.pst || e.dv)) {
      fill = corSeq(e.lider.seq); op = intensidade(e.dp, LIM_VENC);
    }
    p.style.fill = fill; p.style.fillOpacity = op;
    p.classList.toggle("sel", uf === ufSel);
  });

  // placar
  const placar = { "13": 0, "22": 0 }; let ninguem = 0;
  ufs.filter(u => u !== "ZZ").forEach(u => {
    if (cresc) { const g = crescimento(u); if (g) placar[g.saldo >= 0 ? "22" : "13"]++; }
    else if (perd) { const g = perda(u); if (g) { if (g.quem) placar[g.quem]++; else ninguem++; } }
    else if (estados[u].dv) placar[estados[u].lider.n]++;
  });
  $("ufPlacar").innerHTML = [c1, c2].map(c =>
    `<span><i style="background:${corSeq(c.seq)}"></i>${c.nm}: <b>${placar[c.n]}</b> ${cresc ? "estados onde cresceu mais" : perd ? "estados onde perdeu mais votos" : "estados"}</span>`).join("") +
    (perd && ninguem ? `<span><i style="background:var(--muted);opacity:.35"></i>Ninguém perdeu: <b>${ninguem}</b></span>` : "");

  legenda();
  if (ufSel) destacar(ufSel);
}

// índice de cores embaixo do mapa
function legenda() {
  if (modoMapa === "perda") return legendaPerda();
  const cresc = modoMapa === "cresc", lim = cresc ? LIM_CRESC : LIM_VENC;
  const n13 = (CAND_NM["13"] || "LULA").split(" ")[0], n22 = (CAND_NM["22"] || "FLAVIO").split(" ")[0];
  const passos = cresc ? [15, 10, 5, 0, 5, 10, 15] : [30, 20, 10, 0, 10, 20, 30];
  const cor = (n, v) => `color-mix(in srgb, ${corNum(n)} ${Math.round(intensidade(v, lim) * 100)}%, var(--card))`;
  const grad = `linear-gradient(90deg, ${cor("13", lim)} 0%, ${cor("13", 0)} 49.5%, ${cor("22", 0)} 50.5%, ${cor("22", lim)} 100%)`;
  $("mapLegenda").innerHTML = `
    <div class="lgTit">${cresc
      ? "Quem cresceu mais do 1º para o 2º turno (diferença de crescimento, em pontos percentuais)"
      : "Quem vence no 2º turno (vantagem, em pontos percentuais)"}</div>
    <div class="lgBar" style="background:${grad}"></div>
    <div class="lgEsc">${passos.map((v, i) => `<span>${i === 0 || i === passos.length - 1 ? v + "+" : v}</span>`).join("")}</div>
    <div class="lgLados"><span style="color:var(--a)">◀ ${cresc ? n13 + " cresceu mais" : n13 + " vence"}</span>
      <span style="color:var(--b-txt)">${cresc ? n22 + " cresceu mais" : n22 + " vence"} ▶</span></div>
    <div class="lgNota"><i class="lgSem"></i> sem dados · cor mais forte = ${cresc ? "diferença de crescimento maior" : "vantagem maior"}. Toque num estado para ver os números.</div>`;
}

function legendaPerda() {
  const n13 = (CAND_NM["13"] || "LULA").split(" ")[0], n22 = (CAND_NM["22"] || "FLAVIO").split(" ")[0];
  const passos = [10, 5, 0, 5, 10];
  const cor = (n, v) => `color-mix(in srgb, ${corNum(n)} ${Math.round(intensidade(v, LIM_PERDA) * 100)}%, var(--card))`;
  $("mapLegenda").innerHTML = `
    <div class="lgTit">Quem perdeu mais votos do 1º para o 2º turno (em % dos próprios votos do 1º turno)</div>
    <div class="lgBar" style="background:linear-gradient(90deg, ${cor("13", LIM_PERDA)} 0%, ${cor("13", 0)} 49.5%, ${cor("22", 0)} 50.5%, ${cor("22", LIM_PERDA)} 100%)"></div>
    <div class="lgEsc">${passos.map((v, i) => `<span>${i === 0 || i === passos.length - 1 ? v + "%+" : v + "%"}</span>`).join("")}</div>
    <div class="lgLados"><span style="color:var(--a)">◀ ${n13} perdeu mais votos</span><span style="color:var(--b-txt)">${n22} perdeu mais votos ▶</span></div>
    <div class="lgNota"><i class="lgSem" style="background:color-mix(in srgb, var(--muted) 45%, var(--card))"></i> os dois ganharam votos · <i class="lgSem"></i> sem dados · a cor vai para quem perdeu mais votos; mais forte = perdeu uma parte maior do que tinha. Toque num estado para ver os números.</div>`;
}

function destacar(uf) {
  const e = estados[uf], tip = $("mapTip");
  if (!e || !MAPA_UF[uf]) { tip.hidden = true; return; }
  const [a, b] = e.cand;
  tip.hidden = false;
  if (modoMapa === "cresc") {
    const g = crescimento(uf);
    tip.innerHTML = !g ? `<b>${UF_NOME[uf]}</b><br><span class="mini">Sem dados do 1º turno</span>` :
      `<b>${UF_NOME[uf]}</b> <span class="mini">1º → 2º turno</span><br>
      <span style="color:var(--a)">${CAND_NM["13"]}: ${pctFmt(g.p1["13"].pvap)}% → ${pctFmt(g.p2["13"].pvap)}% (${sinal(g.g13, 2)} p.p.)<br>&nbsp;&nbsp;${sinalV(g.v13)} votos</span><br>
      <span style="color:var(--b-txt)">${CAND_NM["22"]}: ${pctFmt(g.p1["22"].pvap)}% → ${pctFmt(g.p2["22"].pvap)}% (${sinal(g.g22, 2)} p.p.)<br>&nbsp;&nbsp;${sinalV(g.v22)} votos</span><br>
      <b style="color:${txtNum(g.saldo >= 0 ? "22" : "13")}">${CAND_NM[g.saldo >= 0 ? "22" : "13"]} cresceu ${pctFmt(Math.abs(g.saldo), 2)} p.p. a mais</b>`;
  } else if (modoMapa === "perda") {
    const g = perda(uf);
    tip.innerHTML = !g ? `<b>${UF_NOME[uf]}</b><br><span class="mini">Sem dados do 1º turno</span>` :
      `<b>${UF_NOME[uf]}</b> <span class="mini">votos no 1º → 2º turno</span><br>
      <span style="color:var(--a)">${CAND_NM["13"]}: ${fmt(g.p1["13"].vap)} → ${fmt(g.p2["13"].vap)} (${sinalV(g.v13)} · ${sinal(g.r13, 1)}%)</span><br>
      <span style="color:var(--b-txt)">${CAND_NM["22"]}: ${fmt(g.p1["22"].vap)} → ${fmt(g.p2["22"].vap)} (${sinalV(g.v22)} · ${sinal(g.r22, 1)}%)</span><br>
      ${g.quem ? `<b style="color:${txtNum(g.quem)}">${CAND_NM[g.quem]} perdeu ${fmt(g.perdeu)} votos (−${pctFmt(g.rq, 1)}%)</b>` : `<b>Os dois ganharam votos</b>`}`;
  } else {
    tip.innerHTML = `<b>${UF_NOME[uf]}</b><br>
      <span style="color:${corTxt(a.seq)}">${a.nm} ${pctFmt(a.pvap)}%</span> · ${fmt(a.vap)}<br>
      <span style="color:${corTxt(b.seq)}">${b.nm} ${pctFmt(b.pvap)}%</span> · ${fmt(b.vap)}<br>
      <span class="mini">Apurado ${pctFmt(e.pst, 1)}% · diferença ${fmt(e.dv)} votos</span>`;
  }
  document.querySelectorAll("#mapa path").forEach(p => p.classList.toggle("hov", p.id === "map-" + uf));
}

// botões Mapa 1 / Mapa 2
document.querySelectorAll(".mapTabs button").forEach(bt => bt.onclick = () => {
  modoMapa = bt.dataset.m;
  document.querySelectorAll(".mapTabs button").forEach(x => x.classList.toggle("on", x === bt));
  if ((modoMapa === "cresc" || modoMapa === "perda") && !t1Carregado) loadTurno1();
  renderStates();
});

// desenha o mapa uma vez
(function montarMapa() {
  const svg = $("mapa");
  svg.setAttribute("viewBox", MAPA_VIEWBOX);
  svg.innerHTML = Object.entries(MAPA_UF).map(([uf, m]) =>
    `<path id="map-${uf}" d="${m.d}"><title>${m.nome}</title></path>`).join("") +
    Object.entries(MAPA_UF).map(([uf, m]) =>
      `<text id="lbl-${uf}" x="${m.cx}" y="${m.cy}" class="maplbl ${["DF","SE","AL","RN","PB","ES","RJ"].includes(uf) ? "sm" : ""}">${uf}</text>`).join("");
  svg.querySelectorAll("path").forEach(p => {
    const uf = p.id.slice(4);
    p.onmouseenter = () => destacar(uf);
    // clicar no estado abre a página de detalhes já nesse estado (no mesmo tipo de mapa)
    p.onclick = () => { location.href = `mapa.html?modo=${modoMapa}#${uf}`; };
  });
})();
loadStates();
loadTurno1();
