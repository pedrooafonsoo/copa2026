// /api/placar — função serverless (Vercel, plano Hobby gratuito).
// Busca os placares da Copa em um endpoint público de resultados e devolve
// um JSON simplificado para o app. Roda no servidor, então não há problema
// de CORS e a fonte fica isolada do front: se um dia precisar trocar,
// só este arquivo muda.
//
// Uso: /api/placar?data=20260613  (data no formato AAAAMMDD)

export default async function handler(req, res) {
  try {
    const data = String(req.query.data || '').replace(/-/g, '');
    if (!/^\d{8}$/.test(data)) {
      return res.status(400).json({ ok: false, erro: 'use ?data=AAAAMMDD' });
    }

    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${data}`;
    const resposta = await fetch(url, { headers: { 'User-Agent': 'CopaDaMilena/1.0' } });
    if (!resposta.ok) throw new Error(`fonte respondeu ${resposta.status}`);
    const corpo = await resposta.json();

    const jogos = (corpo.events || []).map((ev) => {
      const comp = (ev.competitions && ev.competitions[0]) || {};
      const lados = comp.competitors || [];
      const casa = lados.find((l) => l.homeAway === 'home') || lados[0] || {};
      const fora = lados.find((l) => l.homeAway === 'away') || lados[1] || {};
      return {
        id: ev.id,
        inicio: ev.date, // ISO em UTC
        estado: (comp.status && comp.status.type && comp.status.type.state) || 'pre', // pre | in | post
        detalhe: (comp.status && comp.status.type && comp.status.type.shortDetail) || '',
        t1: (casa.team && (casa.team.displayName || casa.team.name)) || '',
        p1: casa.score != null && casa.score !== '' ? Number(casa.score) : null,
        t2: (fora.team && (fora.team.displayName || fora.team.name)) || '',
        p2: fora.score != null && fora.score !== '' ? Number(fora.score) : null,
      };
    });

    // cache na borda da Vercel: 45 s — “tempo real” sem estourar nenhum limite
    res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=120');
    return res.status(200).json({ ok: true, jogos });
  } catch (erro) {
    // o app trata a falha com elegância: segue com a tabela embutida
    return res.status(200).json({ ok: false, jogos: [], erro: String((erro && erro.message) || erro) });
  }
}
