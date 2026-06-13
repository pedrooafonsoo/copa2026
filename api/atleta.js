// /api/atleta — perfil de um jogador via ESPN.
// Uso: /api/atleta?id=ID_ATLETA_ESPN

export default async function handler(req, res) {
  try {
    const id = String(req.query.id || '').replace(/\D/g, '');
    if (!id) return res.status(400).json({ ok: false, erro: 'use ?id=NUMERO' });

    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/athletes/${id}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'CopaDaMilena/1.0' } });
    if (!r.ok) throw new Error(`ESPN ${r.status}`);
    const corpo = await r.json();

    const at = corpo.athlete || corpo;
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      ok: true,
      nome: at.displayName || at.fullName || '',
      posicao: at.position?.displayName || '',
      nascimento: at.dateOfBirth || '',
      idade: at.age ? String(at.age) + ' anos' : '',
      altura: at.displayHeight || (at.height ? at.height + ' m' : ''),
      peso: at.displayWeight || (at.weight ? at.weight + ' kg' : ''),
      pais: at.citizenship || at.birthPlace?.country || at.birthPlace?.city || '',
      clube: at.team?.displayName || at.experience?.team?.displayName || '',
      foto: at.headshot?.href || '',
      numero: at.jersey || '',
    });
  } catch (e) {
    return res.status(200).json({ ok: false, erro: String(e?.message || e) });
  }
}
