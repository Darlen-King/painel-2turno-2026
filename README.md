# Painel 2º turno 2026 — Presidente

Painel ao vivo com o resultado do 2º turno, a diferença de votos e a diferença em pontos percentuais entre os candidatos.
Lê os dados oficiais do TSE (resultados.tse.jus.br) e se atualiza a cada 10 segundos.

- `index.html` — estrutura da página
- `style.css` — visual (tema claro/escuro automático)
- `app.js` — busca e decodifica os dados do TSE (.jws) e atualiza a tela
- `estados.js` — resultado por estado (lista + mapa), atualizado junto com o nacional
- `mapa.js` — contorno simplificado dos estados (base: click_that_hood / IBGE)

Código da eleição padrão: 6258 (pode trocar pelo campo no rodapé ou pela URL: `?e=CODIGO&ano=2026`).
