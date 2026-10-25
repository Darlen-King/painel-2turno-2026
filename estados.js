// Resultado por estado: lista (esquerda) + mapa (direita)
const UFS = ["ac","al","am","ap","ba","ce","df","es","go","ma","mg","ms","mt","pa","pb","pe","pi","pr","rj","rn","ro","rr","rs","sc","se","sp","to","zz"];
const UF_NOME = { ZZ: "Exterior" };
Object.keys(MAPA_UF).forEach(k => UF_NOME[k] = MAPA_UF[k].nome);

const estados = {};          // uf -> dados normalizados
let ufSort = "uf";           // uf | margem | apuracao
let ufSel = null;            // UF destacada
let loadingStates = false;

const corSeq = seq => String(seq) === "1" ? "var(--a)" : "var(--b)";
const corTxt = seq => String(seq) === "1" ? "var(--a)" : "var(--b-txt)";

function resumoUF(j) {
  const cand = [];
  ((j.carg || [])[0]?.agr || []).forEach(ag => (ag.par || []).forEach(p => (p.cand || []).forEach(c =>
    cand.push({ n: c.n, seq: c.n === "13" ? "1" : "2", nm: c.nmu || c.nm, vap: num(c.vap), pvap: pctNum(c.pvap) })
  )));
  cand.sort((x, y) => Number(x.seq) - Number(y.seq));
  const lid = cand.slice().sort((x, y) => y.vap - x.vap);
  return {
    cand, lider: lid[0], dv: (lid[0]?.vap || 0) - (lid[1]?.vap || 0),
    dp: (lid[0]?.pvap || 0) - (lid[1]?.pvap || 0),
    pst: pctNum(j.s?.pst), hg: j.hg
  };
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
      `Atualizado às ${new Date().toLocaleTimeString("pt-BR")}` + (falhas > 1 ? ` · ${falhas} estados sem dados` : "");
    renderStates();
  } finally { loadingStates = false; }
}

function intensidade(dp) { return 0.28 + Math.min(Math.abs(dp), 30) / 30 * 0.72; }

function renderStates() {
  const ufs = Object.keys(estados);
  if (!ufs.length) return;
  const exemplo = estados[ufs[0]].cand;
  const [c1, c2] = exemplo;
  if (!c1 || !c2) return;

  // cabeçalho da tabela
  $("ufHead").innerHTML = `<tr>
    <th data-s="uf">UF</th>
    <th class="r" style="color:${corTxt(c1.seq)}">${c1.nm}</th>
    <th class="r" style="color:${corTxt(c2.seq)}">${c2.nm}</th>
    <th class="r" data-s="margem">Diferença</th>
    <th class="r" data-s="apuracao">Apurado</th></tr>`;
  $("ufHead").querySelectorAll("[data-s]").forEach(th => {
    th.classList.toggle("on", th.dataset.s === ufSort);
    th.onclick = () => { ufSort = th.dataset.s; renderStates(); };
  });

  const ordem = ufs.slice().sort((a, b) =>
    ufSort === "margem" ? estados[b].dp - estados[a].dp :
    ufSort === "apuracao" ? estados[b].pst - estados[a].pst :
    (a === "ZZ") - (b === "ZZ") || a.localeCompare(b));

  $("ufBody").innerHTML = ordem.map(uf => {
    const e = estados[uf], a = e.cand[0], b = e.cand[1];
    const vazio = !e.pst && !(a?.vap || b?.vap);
    const cor = vazio ? "var(--muted)" : corSeq(e.lider.seq);
    return `<tr data-uf="${uf}" class="${uf === ufSel ? "sel" : ""}">
      <td><b>${uf}</b> <span class="ufnm">${UF_NOME[uf] || ""}</span></td>
      <td class="r ${a && a.vap >= (b?.vap || 0) && !vazio ? "win" : ""}">${a ? pctFmt(a.pvap) + "%" : "—"}</td>
      <td class="r ${b && b.vap > (a?.vap || 0) ? "win" : ""}">${b ? pctFmt(b.pvap) + "%" : "—"}</td>
      <td class="r"><span class="chip" style="--c:${cor};--t:${vazio ? cor : corTxt(e.lider.seq)}">${vazio ? "—" : "+" + pctFmt(e.dp, 1) + " p.p."}</span>
        <div class="mini">${vazio ? "" : fmt(e.dv) + " votos"}</div></td>
      <td class="r">${pctFmt(e.pst, 1)}%<div class="prog"><div style="width:${e.pst}%"></div></div></td>
    </tr>`;
  }).join("");
  $("ufBody").querySelectorAll("tr").forEach(tr => {
    tr.onmouseenter = () => destacar(tr.dataset.uf);
    tr.onclick = () => { ufSel = ufSel === tr.dataset.uf ? null : tr.dataset.uf; renderStates(); };
  });

  // mapa
  Object.entries(MAPA_UF).forEach(([uf, m]) => {
    const p = document.getElementById("map-" + uf);
    const e = estados[uf];
    const vazio = !e || (!e.pst && !e.dv);
    p.style.fill = vazio ? "var(--line)" : corSeq(e.lider.seq);
    p.style.fillOpacity = vazio ? 1 : intensidade(e.dp);
    p.classList.toggle("sel", uf === ufSel);
    const lb = document.getElementById("lbl-" + uf);
    if (lb) lb.classList.toggle("dk", !vazio && String(e.lider.seq) === "2");
  });
  // contagem de estados por candidato
  const placar = {};
  ufs.filter(u => u !== "ZZ" && estados[u].dv).forEach(u => {
    const s = estados[u].lider.seq; placar[s] = (placar[s] || 0) + 1;
  });
  $("ufPlacar").innerHTML = [c1, c2].map(c =>
    `<span><i style="background:${corSeq(c.seq)}"></i>${c.nm}: <b>${placar[c.seq] || 0}</b> estados</span>`).join("");
  if (ufSel) destacar(ufSel);
}

function destacar(uf) {
  const e = estados[uf], tip = $("mapTip");
  if (!e || !MAPA_UF[uf]) { tip.hidden = true; return; }
  const [a, b] = e.cand;
  tip.hidden = false;
  tip.innerHTML = `<b>${UF_NOME[uf]}</b><br>
    <span style="color:${corTxt(a.seq)}">${a.nm} ${pctFmt(a.pvap)}%</span> · ${fmt(a.vap)}<br>
    <span style="color:${corTxt(b.seq)}">${b.nm} ${pctFmt(b.pvap)}%</span> · ${fmt(b.vap)}<br>
    <span class="mini">Apurado ${pctFmt(e.pst, 1)}% · diferença ${fmt(e.dv)} votos</span>`;
  document.querySelectorAll("#mapa path").forEach(p => p.classList.toggle("hov", p.id === "map-" + uf));
}

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
    p.onclick = () => {
      ufSel = ufSel === uf ? null : uf; renderStates();
      const tr = document.querySelector(`#ufBody tr[data-uf="${uf}"]`);
      if (tr && ufSel) tr.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
  });
})();
loadStates();
