// /api/detalhe — eventos, estatísticas e escalação via ESPN.
// Na Copa 2026, a ESPN usa flags booleanas nas plays (scoringPlay, yellowCard, etc.)
// e NÃO usa type.text para identificar o tipo de evento.
// Uso: /api/detalhe?id=ID_ESPN

export default async function handler(req, res) {
  try {
    const id = String(req.query.id || '').replace(/\D/g, '');
    if (!id) return res.status(400).json({ ok: false, erro: 'use ?id=NUMERO' });

    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${id}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'CopaDaMilena/1.0' } });
    if (!r.ok) throw new Error(`ESPN ${r.status}`);
    const corpo = await r.json();

    const rostersData = corpo.rosters || [];
    const casaRosterObj = rostersData.find(r => r.homeAway === 'home') || rostersData[0];
    const casaId = casaRosterObj?.team?.id || '';

    // Classifica o tipo de evento usando flags booleanas do ESPN 2026
    const tipoEvento = (play) => {
      if (play.ownGoal) return 'contra';
      if (play.scoringPlay && play.penaltyKick) return 'pen';
      if (play.scoringPlay) return 'gol';
      if (play.substitution) return 'sub';
      if (play.redCard) return 'vermelho';
      if (play.yellowCard) return 'amarelo';
      // fallback para APIs que ainda usam type.text
      const t = (play.type?.text || play.type?.name || '').toLowerCase();
      if (t.includes('substitut')) return 'sub';
      if (t.includes('penalty') && (t.includes('goal') || t.includes('kick'))) return 'pen';
      if (t.includes('own goal')) return 'contra';
      if (t.includes('goal') || t.includes('score')) return 'gol';
      if (t.includes('red card')) return 'vermelho';
      if (t.includes('yellow card') || t === 'yellow') return 'amarelo';
      return null;
    };

    const parseMins = (s) => {
      const m1 = String(s || '').match(/(\d+)\+(\d+)/);
      if (m1) return parseInt(m1[1]) + parseInt(m1[2]);
      const m2 = String(s || '').match(/(\d+)/);
      if (m2) return parseInt(m2[1]);
      return 999;
    };

    const POS_ORDEM = {
      GK:0, G:0, CB:1, LB:2, RB:3, LWB:4, RWB:5, SW:5,
      CDM:6, DM:6, CM:7, CAM:8, AM:8, LM:8, RM:8, LW:9, RW:9,
      CF:10, SS:10, ST:11, FW:11, F:11,
    };

    const rawEvents = [];
    const subsByKey = {};  // `${teamId}_${minuto}` -> [{nome, isStarter, isHome, minuto}]
    const escCasa = [], escFora = [];

    // Coleta substituídos/reservas para pareamento posterior
    const subbedOutByTeam = {};  // teamId -> [{nome, isHome}]
    const subbedInByTeam  = {};  // teamId -> [{nome, isHome}]

    for (const teamRoster of rostersData) {
      const teamId = teamRoster.team?.id || '';
      const isHome = teamId === casaId;
      const titulares = [];

      subbedOutByTeam[teamId] = [];
      subbedInByTeam[teamId]  = [];

      for (const player of (teamRoster.roster || [])) {
        const nome = player.athlete?.displayName || '';
        const athleteId = String(player.athlete?.id || '');
        const isStarter = !!player.starter;
        const posAbbr = player.position?.abbreviation || '';
        const jersey = String(player.jersey || '');

        if (isStarter) {
          titulares.push({ nome, posicao: posAbbr, numero: jersey, athleteId,
            _ord: POS_ORDEM[posAbbr] ?? 50 });
        }

        // Registra substituídos/entrantes a nível de jogador (fallback)
        if (player.subbedOut) subbedOutByTeam[teamId].push({ nome, isHome });
        if (player.subbedIn)  subbedInByTeam[teamId].push({ nome, isHome });

        for (const play of (player.plays || [])) {
          const tipo = tipoEvento(play);
          if (!tipo) continue;
          const minuto = play.clock?.displayValue || '';

          if (tipo === 'sub') {
            const key = `${teamId}_${minuto}`;
            if (!subsByKey[key]) subsByKey[key] = [];
            subsByKey[key].push({ nome, isStarter, isHome, minuto });
          } else {
            rawEvents.push({ tipo, minuto, jogador: nome, eCasa: isHome,
              athleteId, _min: parseMins(minuto) });
          }
        }
      }

      titulares.sort((a, b) => a._ord - b._ord);
      const esc = titulares.map(({ _ord, ...p }) => p);
      if (isHome) escCasa.push(...esc);
      else escFora.push(...esc);
    }

    // Emparelha substituições vindas de plays (substitution: true)
    const subEvents = [];
    for (const group of Object.values(subsByKey)) {
      const saiu   = group.find(p => p.isStarter);
      const entrou = group.find(p => !p.isStarter);
      if (!saiu && !entrou) continue;
      subEvents.push({
        tipo: 'sub',
        minuto: (saiu || entrou).minuto || '',
        jogador: saiu?.nome || '',
        jogadorSub: entrou?.nome || '',
        eCasa: (saiu || entrou).isHome || false,
        _min: parseMins((saiu || entrou).minuto),
      });
    }

    // Fallback: se não vieram substituições via plays, usa flags do jogador
    if (subEvents.length === 0) {
      for (const teamId of Object.keys(subbedOutByTeam)) {
        const saindo  = subbedOutByTeam[teamId];
        const entrando = subbedInByTeam[teamId];
        for (let i = 0; i < Math.max(saindo.length, entrando.length); i++) {
          const saiu   = saindo[i];
          const entrou = entrando[i];
          subEvents.push({
            tipo: 'sub', minuto: '', jogador: saiu?.nome || '',
            jogadorSub: entrou?.nome || '', eCasa: (saiu || entrou)?.isHome || false, _min: 999,
          });
        }
      }
    }

    const eventos = [...rawEvents, ...subEvents]
      .sort((a, b) => a._min - b._min)
      .map(({ _min, ...e }) => e);

    // Estatísticas do boxscore
    const STATS = ['corners', 'yellowCards', 'redCards', 'shotsOnTarget', 'shots', 'possessionPct'];
    const timesBox = corpo.boxscore?.teams || [];
    const casaBox = timesBox.find(t => t.team?.id === casaId) || timesBox[0];
    const foraBox = timesBox.find(t => t.team?.id !== (casaId || 'x')) || timesBox[1];
    const extrairStats = (t) => t
      ? Object.fromEntries(
          (t.statistics || []).filter(s => STATS.includes(s.name)).map(s => [s.name, s.displayValue])
        )
      : {};

    res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=120');
    return res.status(200).json({
      ok: true,
      eventos,
      statsCasa: extrairStats(casaBox),
      statsFora: extrairStats(foraBox),
      escCasa,
      escFora,
      casaId,
    });
  } catch (e) {
    return res.status(200).json({
      ok: false, erro: String(e?.message || e),
      eventos: [], statsCasa: {}, statsFora: {}, escCasa: [], escFora: [],
    });
  }
}
