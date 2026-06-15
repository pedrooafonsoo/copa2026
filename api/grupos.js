// /api/grupos — classificação oficial de cada grupo via ESPN.
// Retorna as tabelas na ordem oficial (com tiebreaker de fair play já aplicado).

export default async function handler(req, res) {
  try {
    const url = 'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings';
    const r = await fetch(url, { headers: { 'User-Agent': 'CopaDaMilena/1.0' } });
    if (!r.ok) throw new Error(`ESPN ${r.status}`);
    const corpo = await r.json();

    const num = (stats, ...nomes) => {
      for (const n of nomes) {
        const s = (stats || []).find(x => x.name === n);
        if (s != null) return parseFloat(s.value ?? s.displayValue) || 0;
      }
      return 0;
    };

    const grupos = {};
    for (const g of (corpo.groups || [])) {
      const letra = (g.abbreviation || g.name || '').replace(/group\s*/i, '').trim();
      if (!letra || letra.length > 1) continue;
      grupos[letra] = (g.entries || []).map(entry => {
        const stats = entry.stats || [];
        const v = num(stats, 'wins');
        const e = num(stats, 'ties');
        const d = num(stats, 'losses');
        const gp = num(stats, 'pointsFor', 'goalsFor');
        const gc = num(stats, 'pointsAgainst', 'goalsAgainst');
        return {
          selecao: entry.team?.displayName || entry.team?.name || '',
          p: num(stats, 'points'),
          j: v + e + d,
          v, e, d, gp, gc,
        };
      });
    }

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    return res.status(200).json({ ok: true, grupos });
  } catch (e) {
    return res.status(200).json({ ok: false, grupos: {}, erro: String(e?.message || e) });
  }
}
