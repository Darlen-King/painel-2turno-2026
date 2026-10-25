// Coleta a diferença nacional no TSE e grava em historico.json (roda no GitHub Actions)
import fs from "fs";

const CODE = process.env.CODE || "6258";
const ANO = process.env.ANO || "2026";
const URL_TSE = `https://resultados.tse.jus.br/oficial/ele${ANO}/${CODE}/dados/br/br-c0001-e${CODE.padStart(6, "0")}-u.jws`;
const ARQ = "historico.json";
const DURACAO = Number(process.env.DURACAO_S || 270) * 1000; // fica coletando ~4,5 min por execução
const INTERVALO = 20000;                                       // uma leitura a cada 20 s

const hist = fs.existsSync(ARQ) ? JSON.parse(fs.readFileSync(ARQ, "utf8") || "[]") : [];
const vistos = new Set(hist.map(h => h.t));
const num = s => Number(String(s ?? "0").replace(/\./g, "").replace(",", "."));
const tsNum = t => { const m = String(t).match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+):(\d+)/); return m ? Date.UTC(m[3], m[2] - 1, m[1], m[4], m[5], m[6]) : 0; };

async function lerUma() {
  const r = await fetch(`${URL_TSE}?_=${Date.now()}`, { headers: { "user-agent": "Mozilla/5.0 (painel-2turno-2026)" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const txt = (await r.text()).trim();
  const j = txt.startsWith("{") ? JSON.parse(txt) : JSON.parse(Buffer.from(txt.split(".")[1], "base64url").toString("utf8"));
  const cand = [];
  (j.carg?.[0]?.agr || []).forEach(ag => (ag.par || []).forEach(p => (p.cand || []).forEach(c => cand.push({ n: c.n, v: num(c.vap) }))));
  if (cand.length < 2) return;
  cand.sort((a, b) => b.v - a.v);
  const t = `${j.dg || j.dt} ${j.hg || j.ht}`.trim();
  if (vistos.has(t)) return;
  vistos.add(t);
  hist.push({ t, v: cand[0].v - cand[1].v, leader: cand[0].n, pst: num(j.s?.pst) });
  console.log("nova leitura", t, cand[0].n, cand[0].v - cand[1].v);
}

const fim = Date.now() + DURACAO;
for (;;) {
  try { await lerUma(); } catch (e) { console.log("erro:", e.message); }
  if (Date.now() + INTERVALO > fim) break;
  await new Promise(r => setTimeout(r, INTERVALO));
}
hist.sort((a, b) => tsNum(a.t) - tsNum(b.t));
fs.writeFileSync(ARQ, JSON.stringify(hist));
console.log(`total: ${hist.length} leituras`);
