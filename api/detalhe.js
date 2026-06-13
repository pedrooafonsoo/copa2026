// /api/detalhe — eventos (gols, cartões) e estatísticas de um jogo via ESPN.
// Uso: /api/detalhe?id=ID_ESPN  (o ID chega via /api/placar)

export default async function handler(req, res) {
  try {
    const id = String(req.query.id || '').replace(/\D/g, '');
    if (!id) return res.status(400).json({ ok: false, erro: 'use ?id=NUMERO' });

    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${id}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'CopaDaMilena/1.0' } });
    if (!r.ok) throw new Error(`ESPN ${r.status}`);
    const corpo = await r.json();

    const comp = (corpo.header?.competitions || [])[0] || {};
    const lados = comp.competitors || [];
    const casa = lados.find(l => l.homeAway === 'home') || lados[0] || {};

    const tipoEvento = (text) => {
      const t = (text || '').toLowerCase();
      if (t.includes('penalty')) return 'pen';
      if (t.includes('own goal')) return 'contra';
      if (t.includes('goal')) return 'gol';
      if (t.includes('second yellow') || (t.includes('red') && t.includes('yellow'))) return 'vermelho';
      if (t.includes('red card')) return 'vermelho';
      if (t.includes('yellow')) return 'amarelo';
      return null;
    };

    const eventos = (comp.details || [])
      .map(d => ({
        tipo: tipoEvento(d.type?.text),
        minuto: d.clock?.displayValue || '',
        jogador: (d.athletesInvolved || [])[0]?.displayName || '',
        eCasa: (d.team?.id || '') === (casa.id || ''),
      }))
      .filter(e => e.tipo !== null);

    const STATS = ['corners', 'yellowCards', 'redCards', 'shotsOnTarget', 'shots', 'possessionPct'];
    const timesBox = corpo.boxscore?.teams || [];
    const casaBox = timesBox.find(t => t.team?.id === casa.id) || timesBox[0];
    const foraBox = timesBox.find(t => t.team?.id !== casa.id) || timesBox[1];

    const extrairStats = (t) => t
      ? Object.fromEntries(
          (t.statistics || []).filter(s => STATS.includes(s.name)).map(s => [s.name, s.displayValue])
        )
      : {};

    res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=120');
    return res.status(200).json({ ok: true, eventos, statsCasa: extrairStats(casaBox), statsFora: extrairStats(foraBox) });
  } catch (e) {
    return res.status(200).json({ ok: false, erro: String(e?.message || e), eventos: [], statsCasa: {}, statsFora: {} });
  }
}
