// Gera data/mun/<uf>.json (resultado por cidade, 1º e 2º turno) e data/geo/<uf>.json (contornos do IBGE)
// Roda no GitHub Actions (workflow "Gerar dados por cidade").
import fs from "fs";

const ANO = "2026", T1 = process.env.T1 || "6257", T2 = process.env.T2 || "6258";
const BASE = `https://resultados.tse.jus.br/oficial/ele${ANO}`;
const UFS = (process.env.UFS || "ac al am ap ba ce df es go ma mg ms mt pa pb pe pi pr rj rn ro rr rs sc se sp to").split(/\s+/);
const pad = c => String(c).padStart(6, "0");
const num = s => Number(String(s ?? "0").replace(/\./g, "").replace(",", "."));
const pct = s => Number(String(s ?? "0").replace(",", "."));
const dormir = ms => new Promise(r => setTimeout(r, ms));

async function baixar(url, tentativas = 4) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (painel-2turno-2026)" } });
      if (r.ok) return await r.text();
      if (r.status === 404) throw new Error("404");
    } catch (e) { if (e.message === "404") throw e; }
    await dormir(1000 * (i + 1));
  }
  throw new Error("falhou: " + url);
}
const jws = t => { t = t.trim(); return t.startsWith("{") ? JSON.parse(t) : JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString("utf8")); };
function resumo(j) {
  const o = { pst: pct(j.s?.pst) };
  ((j.carg || [])[0]?.agr || []).forEach(ag => (ag.par || []).forEach(p => (p.cand || []).forEach(c => {
    if (c.n === "13" || c.n === "22") o[c.n] = [num(c.vap), pct(c.pvap)];
  })));
  return o;
}

const cfg = jws(await baixar(`${BASE}/${T2}/config/mun-e${pad(T2)}-cm.jws`));
fs.mkdirSync("data/mun", { recursive: true });
fs.mkdirSync("data/geo", { recursive: true });

for (const uf of UFS) {
  const lista = cfg.abr.find(a => a.cd === uf)?.mu || [];
  const out = [], fila = lista.slice();
  async function trabalhador() {
    while (fila.length) {
      const m = fila.shift();
      try {
        const [a, b] = await Promise.all([
          baixar(`${BASE}/${T1}/dados/${uf}/${uf}${m.cd}-c0001-e${pad(T1)}-u.jws`),
          baixar(`${BASE}/${T2}/dados/${uf}/${uf}${m.cd}-c0001-e${pad(T2)}-u.jws`)
        ]);
        out.push({ cd: m.cd, cdi: m.cdi, nm: m.nm, t1: resumo(jws(a)), t2: resumo(jws(b)) });
      } catch (e) { console.log(uf, m.cd, m.nm, e.message); out.push({ cd: m.cd, cdi: m.cdi, nm: m.nm }); }
    }
  }
  await Promise.all(Array.from({ length: 16 }, trabalhador));
  out.sort((a, b) => a.nm.localeCompare(b.nm, "pt-BR"));
  fs.writeFileSync(`data/mun/${uf}.json`, JSON.stringify({ gerado: new Date().toISOString(), t1: T1, t2: T2, mun: out }));

  const geo = await baixar(`https://servicodados.ibge.gov.br/api/v3/malhas/estados/${uf.toUpperCase()}?intrarregiao=municipio&formato=application/vnd.geo+json&qualidade=minima`);
  fs.writeFileSync(`data/geo/${uf}.json`, geo);
  console.log(`${uf}: ${out.length} cidades, ${out.filter(m => m.t2).length} com resultado`);
}
