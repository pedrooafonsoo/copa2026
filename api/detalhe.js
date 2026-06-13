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
      if (t.includes('penalty') || t.includes('pen.')) return 'pen';
      if (t.includes('own goal') || t.includes('own-goal')) return 'contra';
      if (t.includes('goal') || t.includes('score') || t === 'gol') return 'gol';
      if (t.includes('second yellow') || (t.includes('red') && t.includes('yellow'))) return 'vermelho';
      if (t.includes('red card') || t === 'red') return 'vermelho';
      if (t.includes('yellow') || t === 'yellow') return 'amarelo';
      return null;
    };

    // Fonte 1: details no header (gols + cartões)
    const detailEvents = (comp.details || [])
      .map(d => ({
        tipo: tipoEvento(d.type?.text || d.type?.name || String(d.type || '')),
        minuto: d.clock?.displayValue || '',
        jogador: (d.athletesInvolved || [])[0]?.displayName || '',
        eCasa: (d.team?.id || '') === (casa.id || ''),
      }))
      .filter(e => e.tipo !== null);

    // Fonte 2: scoringPlays
    const scoringPlays = corpo.scoringPlays || [];
    const goalsFromScoring = scoringPlays.map(sp => ({
      tipo: tipoEvento(sp.type?.text || sp.type?.name || String(sp.type || '')),
      minuto: sp.clock?.displayValue || '',
      jogador: (sp.participants || [])[0]?.athlete?.displayName ||
               (sp.athletes || [])[0]?.displayName ||
               sp.athlete?.displayName || sp.text || '',
      eCasa: (sp.team?.id || '') === (casa.id || ''),
    })).filter(e => e.tipo !== null);

    // Fonte 3: plays (lista completa de eventos, se disponível)
    const playsData = corpo.plays || [];
    const goalsFromPlays = playsData
      .map(p => {
        const tipo = tipoEvento(p.type?.text || p.type?.name || String(p.type || ''));
        if (!tipo) return null;
        return {
          tipo,
          minuto: p.clock?.displayValue || '',
          jogador: (p.participants || [])[0]?.athlete?.displayName ||
                   p.athlete?.displayName || p.text || '',
          eCasa: (p.team?.id || '') === (casa.id || ''),
        };
      })
      .filter(Boolean);

    // Prioridade: detailEvents > goalsFromScoring > goalsFromPlays
    let eventos = [];
    if (detailEvents.length > 0) {
      // Tenta complementar nomes vazios via scoringPlays
      eventos = detailEvents.map(ev => {
        if ((ev.tipo === 'gol' || ev.tipo === 'pen' || ev.tipo === 'contra') && !ev.jogador) {
          const match = goalsFromScoring.find(g => g.minuto === ev.minuto && g.eCasa === ev.eCasa);
          if (match?.jogador) return { ...ev, jogador: match.jogador };
        }
        return ev;
      });
    } else if (goalsFromScoring.length > 0) {
      eventos = goalsFromScoring;
    } else {
      eventos = goalsFromPlays;
    }

    // Estatísticas
    const STATS = ['corners', 'yellowCards', 'redCards', 'shotsOnTarget', 'shots', 'possessionPct'];
    const timesBox = corpo.boxscore?.teams || [];
    const casaBox = timesBox.find(t => t.team?.id === casa.id) || timesBox[0];
    const foraBox = timesBox.find(t => t.team?.id !== (casa.id || 'x')) || timesBox[1];
    const extrairStats = (t) => t
      ? Object.fromEntries(
          (t.statistics || []).filter(s => STATS.includes(s.name)).map(s => [s.name, s.displayValue])
        )
      : {};

    // Escalação: tenta via rosters (estrutura ESPN para futebol)
    const POS_ORDEM = { GK:0, CB:1, LB:2, RB:3, LWB:4, RWB:5, SW:5, CDM:6, DM:6, CM:7, CAM:8, AM:8, LM:8, RM:8, LW:9, RW:9, CF:10, SS:10, ST:11, FW:11 };
    const rostersData = corpo.rosters || [];
    const casaRosterRaw = rostersData.find(r => r.team?.id === casa.id);
    const foraRosterRaw = rostersData.find(r => r.team?.id !== (casa.id || 'x'));

    const extrairDeRoster = (rosterObj) => {
      if (!rosterObj) return [];
      return (rosterObj.roster || [])
        .filter(a => a.starter)
        .sort((a, b) => (POS_ORDEM[a.position?.abbreviation] ?? 50) - (POS_ORDEM[b.position?.abbreviation] ?? 50))
        .map(a => ({
          nome: a.athlete?.displayName || a.displayName || '',
          posicao: a.position?.abbreviation || '',
          numero: a.jersey || '',
        }));
    };

    // Fallback: boxscore.players
    const playersBox = corpo.boxscore?.players || [];
    const casaPlayers = playersBox.find(t => t.team?.id === casa.id) || playersBox[0];
    const foraPlayers = playersBox.find(t => t.team?.id !== (casa.id || 'x')) || playersBox[1];

    const extrairDeBoxscore = (box) => {
      if (!box) return [];
      // Tenta todas as categorias de statistics, não só a primeira
      for (const stat of (box.statistics || [])) {
        const titulares = (stat.athletes || []).filter(a => a.starter);
        if (titulares.length > 0) {
          return titulares
            .sort((a, b) => (POS_ORDEM[a.athlete?.position?.abbreviation] ?? 50) - (POS_ORDEM[b.athlete?.position?.abbreviation] ?? 50))
            .map(a => ({
              nome: a.athlete?.displayName || '',
              posicao: a.athlete?.position?.abbreviation || '',
              numero: a.athlete?.jersey || '',
            }));
        }
      }
      return [];
    };

    const escCasa = extrairDeRoster(casaRosterRaw).length > 0
      ? extrairDeRoster(casaRosterRaw)
      : extrairDeBoxscore(casaPlayers);
    const escFora = extrairDeRoster(foraRosterRaw).length > 0
      ? extrairDeRoster(foraRosterRaw)
      : extrairDeBoxscore(foraPlayers);

    res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=120');
    return res.status(200).json({
      ok: true,
      eventos,
      statsCasa: extrairStats(casaBox),
      statsFora: extrairStats(foraBox),
      escCasa,
      escFora,
      casaId: casa.id || '',
    });
  } catch (e) {
    return res.status(200).json({ ok: false, erro: String(e?.message || e), eventos: [], statsCasa: {}, statsFora: {}, escCasa: [], escFora: [] });
  }
}
