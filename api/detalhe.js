// /api/detalhe — eventos (gols, cartões), estatísticas e escalação via ESPN.
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
      if (t.includes('goal') || t.includes('score')) return 'gol';
      if (t.includes('second yellow') || (t.includes('red') && t.includes('yellow'))) return 'vermelho';
      if (t.includes('red card')) return 'vermelho';
      if (t.includes('yellow')) return 'amarelo';
      return null;
    };

    // Eventos do details (gols + cartões)
    const detailEvents = (comp.details || [])
      .map(d => ({
        tipo: tipoEvento(d.type?.text),
        minuto: d.clock?.displayValue || '',
        jogador: (d.athletesInvolved || [])[0]?.displayName || '',
        eCasa: (d.team?.id || '') === (casa.id || ''),
      }))
      .filter(e => e.tipo !== null);

    // Fallback: scoringPlays para gols sem jogador no details
    const scoringPlays = corpo.scoringPlays || [];
    const goalsFromScoring = scoringPlays.map(sp => ({
      tipo: (sp.type?.text || '').toLowerCase().includes('penalty') ? 'pen'
          : (sp.type?.text || '').toLowerCase().includes('own') ? 'contra' : 'gol',
      minuto: sp.clock?.displayValue || '',
      jogador: (sp.participants || [])[0]?.athlete?.displayName || sp.text || '',
      eCasa: (sp.team?.id || '') === (casa.id || ''),
    }));

    // Mescla: usa detalhes; para gols sem jogador, tenta complementar com scoringPlays
    const eventos = detailEvents.length > 0 ? detailEvents.map(ev => {
      if ((ev.tipo === 'gol' || ev.tipo === 'pen' || ev.tipo === 'contra') && !ev.jogador) {
        const match = goalsFromScoring.find(g => g.minuto === ev.minuto && g.eCasa === ev.eCasa);
        if (match?.jogador) return { ...ev, jogador: match.jogador };
      }
      return ev;
    }) : goalsFromScoring;

    // Estatísticas
    const STATS = ['corners', 'yellowCards', 'redCards', 'shotsOnTarget', 'shots', 'possessionPct'];
    const timesBox = corpo.boxscore?.teams || [];
    const casaBox = timesBox.find(t => t.team?.id === casa.id) || timesBox[0];
    const foraBox = timesBox.find(t => t.team?.id !== casa.id) || timesBox[1];
    const extrairStats = (t) => t
      ? Object.fromEntries(
          (t.statistics || []).filter(s => STATS.includes(s.name)).map(s => [s.name, s.displayValue])
        )
      : {};

    // Escalação (titulares)
    const playersBox = corpo.boxscore?.players || [];
    const casaPlayers = playersBox.find(t => t.team?.id === casa.id) || playersBox[0];
    const foraPlayers = playersBox.find(t => t.team?.id !== casa.id) || playersBox[1];

    const POS_ORDEM = { GK:0, CB:1, LB:2, RB:3, LWB:4, RWB:5, SW:5, CDM:6, DM:6, CM:7, CAM:8, AM:8, LM:8, RM:8, LW:9, RW:9, CF:10, SS:10, ST:11, FW:11 };
    const extrairTitulares = (box) => {
      if (!box) return [];
      return ((box.statistics || [])[0]?.athletes || [])
        .filter(a => a.starter)
        .sort((a, b) => (POS_ORDEM[a.athlete?.position?.abbreviation] ?? 50) - (POS_ORDEM[b.athlete?.position?.abbreviation] ?? 50))
        .map(a => ({
          nome: a.athlete?.displayName || '',
          posicao: a.athlete?.position?.abbreviation || '',
          numero: a.athlete?.jersey || '',
        }));
    };

    res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=120');
    return res.status(200).json({
      ok: true,
      eventos,
      statsCasa: extrairStats(casaBox),
      statsFora: extrairStats(foraBox),
      escCasa: extrairTitulares(casaPlayers),
      escFora: extrairTitulares(foraPlayers),
      casaId: casa.id || '',
    });
  } catch (e) {
    return res.status(200).json({ ok: false, erro: String(e?.message || e), eventos: [], statsCasa: {}, statsFora: {}, escCasa: [], escFora: [] });
  }
}
