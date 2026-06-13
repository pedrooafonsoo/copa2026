/* ============================================================
   A COPA DA MILENA — lógica do app
   - Tabela completa embutida (js/dados.js): funciona offline.
   - Placar ao vivo: /api/placar consulta um serviço público de
     resultados; o app atualiza a cada 60 s e guarda o que já
     terminou, calculando a classificação dos grupos sozinho.
   ============================================================ */

(() => {
'use strict';

/* ---------- utilidades ---------- */
const $  = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

// storage seguro: se o navegador bloquear, o app segue funcionando
const cofre = {
  ler(chave) { try { return JSON.parse(localStorage.getItem(chave)); } catch { return null; } },
  gravar(chave, valor) { try { localStorage.setItem(chave, JSON.stringify(valor)); } catch {} },
};

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

const FUSO_BRT = -3 * 60; // minutos
function agoraBRT() {
  const d = new Date();
  return new Date(d.getTime() + (d.getTimezoneOffset() + FUSO_BRT) * 60000);
}
function dataBRT(date) { // Date -> "AAAA-MM-DD" no fuso de Brasília
  const d = new Date(date.getTime() + (date.getTimezoneOffset() + FUSO_BRT) * 60000);
  return d.toISOString().slice(0, 10);
}
function horaBRT(date) {
  const d = new Date(date.getTime() + (date.getTimezoneOffset() + FUSO_BRT) * 60000);
  return String(d.getUTCHours()).padStart(2, '0') + 'h' + String(d.getUTCMinutes()).padStart(2, '0');
}
const hojeISO = () => dataBRT(new Date());

const DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
function dataLonga(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return `${DIAS[dt.getUTCDay()]}, ${d} de ${MESES[m - 1]}`;
}

const FASES = {
  grupos:   'Fase de grupos',
  fase32:   'Mata-mata · Fase de 32',
  oitavas:  'Oitavas de final',
  quartas:  'Quartas de final',
  semis:    'Semifinal',
  terceiro: 'Decisão de 3º lugar',
  final:    'A Grande Final',
};

/* ---------- tradução de nomes vindos da API (inglês -> pt-BR) ---------- */
const TRADUCAO = {
  'mexico':'México','south africa':'África do Sul','south korea':'Coreia do Sul',
  'korea republic':'Coreia do Sul','czechia':'República Tcheca','czech republic':'República Tcheca',
  'canada':'Canadá','bosnia and herzegovina':'Bósnia e Herzegovina','bosnia-herzegovina':'Bósnia e Herzegovina',
  'qatar':'Catar','switzerland':'Suíça','brazil':'Brasil','morocco':'Marrocos','haiti':'Haiti',
  'scotland':'Escócia','united states':'Estados Unidos','usa':'Estados Unidos','paraguay':'Paraguai',
  'australia':'Austrália','turkey':'Turquia','turkiye':'Turquia','germany':'Alemanha','curacao':'Curaçao',
  'ivory coast':'Costa do Marfim','cote divoire':'Costa do Marfim',"cote d'ivoire":'Costa do Marfim',
  'ecuador':'Equador','netherlands':'Holanda','japan':'Japão','sweden':'Suécia','tunisia':'Tunísia',
  'belgium':'Bélgica','egypt':'Egito','iran':'Irã','new zealand':'Nova Zelândia','spain':'Espanha',
  'cape verde':'Cabo Verde','cape verde islands':'Cabo Verde','saudi arabia':'Arábia Saudita',
  'uruguay':'Uruguai','france':'França','senegal':'Senegal','iraq':'Iraque','norway':'Noruega',
  'argentina':'Argentina','algeria':'Argélia','austria':'Áustria','jordan':'Jordânia','portugal':'Portugal',
  'dr congo':'RD Congo','congo dr':'RD Congo','democratic republic of the congo':'RD Congo',
  'uzbekistan':'Uzbequistão','colombia':'Colômbia','england':'Inglaterra','croatia':'Croácia',
  'panama':'Panamá','ghana':'Gana',
};
const traduz = (nome) => TRADUCAO[norm(nome)] || nome;

/* ---------- estado: resultados acumulados ---------- */
// chave de um jogo: data + times em ordem alfabética (independe de mando)
const chaveJogo = (data, t1, t2) => `${data}|${[norm(t1), norm(t2)].sort().join('|')}`;

const resultados = cofre.ler('copa.resultados') || {}; // chave -> {p1,p2,fim,detalhe,t1,t2}
// resultados já embutidos no dados.js (ex.: o jogo de abertura)
for (const j of DADOS.jogos) {
  if (j.fim && j.p1 != null) {
    const k = chaveJogo(j.data, j.t1, j.t2);
    if (!resultados[k]) resultados[k] = { p1: j.p1, p2: j.p2, fim: true, t1: j.t1, t2: j.t2 };
  }
}
let aoVivoHoje = [];      // jogos de hoje vindos da API (inclusive em andamento)
let apiDisponivel = null; // null = ainda não tentou; true/false depois

function resultadoDe(jogo) {
  const r = resultados[chaveJogo(jogo.data, jogo.t1, jogo.t2)];
  if (!r) return null;
  // garante placar na ordem t1/t2 do nosso calendário
  if (norm(r.t1) === norm(jogo.t1)) return r;
  return { ...r, p1: r.p2, p2: r.p1, t1: jogo.t1, t2: jogo.t2 };
}

/* ---------- classificação dos grupos, calculada dos resultados ---------- */
function classificacao(letra) {
  const grupo = DADOS.grupos.find(g => g.letra === letra);
  const tabela = grupo.selecoes.map(s => ({ selecao: s, p: 0, j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0 }));
  const porNome = Object.fromEntries(tabela.map(t => [norm(t.selecao), t]));
  for (const j of DADOS.jogos) {
    if (j.fase !== 'grupos' || j.grupo !== letra) continue;
    const r = resultadoDe(j);
    if (!r || !r.fim) continue;
    const a = porNome[norm(j.t1)], b = porNome[norm(j.t2)];
    if (!a || !b) continue;
    a.j++; b.j++; a.gp += r.p1; a.gc += r.p2; b.gp += r.p2; b.gc += r.p1;
    if (r.p1 > r.p2) { a.v++; b.d++; a.p += 3; }
    else if (r.p1 < r.p2) { b.v++; a.d++; b.p += 3; }
    else { a.e++; b.e++; a.p++; b.p++; }
  }
  return tabela.sort((x, y) => y.p - x.p || (y.gp - y.gc) - (x.gp - x.gc) || y.gp - x.gp ||
                               x.selecao.localeCompare(y.selecao));
}

/* ---------- placar ao vivo ---------- */
async function buscarPlacar() {
  const hoje = hojeISO();
  const amanha = dataBRT(new Date(Date.now() + 864e5));
  try {
    const respostas = await Promise.all([hoje, amanha].map(d =>
      fetch(`/api/placar?data=${d.replace(/-/g, '')}`).then(r => r.json())));
    const eventos = respostas.flatMap(r => (r && r.jogos) || []);
    if (!respostas.some(r => r && r.ok)) throw new Error('sem dados');
    apiDisponivel = true;
    aoVivoHoje = [];
    for (const ev of eventos) {
      const inicio = new Date(ev.inicio);
      const data = dataBRT(inicio);
      const t1 = traduz(ev.t1), t2 = traduz(ev.t2);
      const item = { data, hora: horaBRT(inicio), t1, t2, p1: ev.p1, p2: ev.p2,
                     estado: ev.estado, detalhe: ev.detalhe, espnId: ev.id };
      if (data === hoje) aoVivoHoje.push(item);
      if (ev.estado === 'post' && ev.p1 != null) {
        resultados[chaveJogo(data, t1, t2)] = { p1: ev.p1, p2: ev.p2, fim: true, t1, t2, detalhe: ev.detalhe, espnId: ev.id };
      } else if (ev.estado === 'in' && ev.p1 != null) {
        resultados[chaveJogo(data, t1, t2)] = { p1: ev.p1, p2: ev.p2, fim: false, t1, t2, detalhe: ev.detalhe, espnId: ev.id };
      }
    }
    cofre.gravar('copa.resultados', resultados);
    // Busca eventos dos jogos ao vivo para o ticker (limpa cache para ter dados frescos)
    const vivosComId = aoVivoHoje.filter(j => j.estado === 'in' && j.espnId);
    vivosComId.forEach(j => delete detalheCache[j.espnId]);
    await Promise.all(vivosComId.map(j => buscarDetalhe(j.espnId)));
  } catch {
    if (apiDisponivel === null) apiDisponivel = false;
  }
  atualizarStatus();
  renderTelaAtiva();
}

function atualizarStatus() {
  const caixa = $('#statusConexao');
  if (apiDisponivel) {
    caixa.hidden = false;
    $('#statusTexto').textContent = aoVivoHoje.some(j => j.estado === 'in') ? 'ao vivo' : 'atualizado';
  } else caixa.hidden = true;
}

/* ---------- componentes ---------- */
function linhaJogo(j, opcoes = {}) {
  const r = resultadoDe(j);
  const vivo = aoVivoHoje.find(v => v.data === j.data &&
      chaveJogo(v.data, v.t1, v.t2) === chaveJogo(j.data, j.t1, j.t2));
  const emAndamento = vivo && vivo.estado === 'in';
  const encerrado = (r && r.fim) || (vivo && vivo.estado === 'post');
  const p1 = emAndamento ? vivo.p1 : r ? r.p1 : null;
  const p2 = emAndamento ? vivo.p2 : r ? r.p2 : null;
  const cls = ['jogo', j.brasil ? 'do-brasil' : '', encerrado ? 'encerrado' : ''].join(' ').trim();
  const g = (a, b) => (encerrado && a > b) ? 'vencedor' : '';
  const fase = j.fase === 'grupos' ? `Grupo ${j.grupo}` : FASES[j.fase];
  const numero = j.num && j.fase !== 'grupos' ? `Jogo ${j.num} · ` : '';

  const espnId = r?.espnId || vivo?.espnId || null;
  const clicavel = !!(espnId && (emAndamento || encerrado));

  // Minutagem: "23'", "45'+2'", "intervalo", etc.
  const statusVivo = emAndamento
    ? ((vivo.detalhe || '').toLowerCase() === 'ht' ? 'intervalo' : vivo.detalhe || 'ao vivo')
    : null;

  const inner = `
    <div class="${cls}">
      <div class="jogo-hora">${j.hora}
        ${emAndamento
          ? `<span class="vivo">${statusVivo}</span>`
          : encerrado ? `<span class="vivo" style="color:var(--giz-suave)">fim</span>` : ''}
      </div>
      <div class="jogo-times">
        <div class="jogo-linha"><span class="${g(p1, p2)}">${j.t1}</span><span class="gols">${p1 ?? ''}</span></div>
        <div class="jogo-linha"><span class="${g(p2, p1)}">${j.t2}</span><span class="gols">${p2 ?? ''}</span></div>
        ${opcoes.semLocal ? '' : `<div class="jogo-local">${numero}${j.cidade} · ${j.estadio}</div>`}
      </div>
      <div class="jogo-fase">${fase}${clicavel ? '<span class="btn-detalhe">▾</span>' : ''}</div>
    </div>`;

  // Ticker inline para jogos ao vivo (visível sem clicar, atualiza a cada minuto)
  const evVivos = emAndamento && espnId ? detalheCache[espnId]?.eventos : null;
  const ticker = evVivos?.length ? `
    <div class="jogo-ticker">
      ${evVivos.map(ev => {
        const icoCls = (ev.tipo === 'gol' || ev.tipo === 'pen' || ev.tipo === 'contra') ? 'ev-gol'
          : ev.tipo === 'amarelo' ? 'ev-amarelo' : 'ev-vermelho';
        const sub = ev.tipo === 'pen' ? ' <span class="ev-sub">pên.</span>'
          : ev.tipo === 'contra' ? ' <span class="ev-sub">c.g.</span>' : '';
        return `<div class="tick-ev ${ev.eCasa ? 'tick-casa' : 'tick-fora'}">
          <span class="tick-min">${ev.minuto}</span>
          <span class="ev-ico ${icoCls}"></span>
          <span class="tick-nome">${ev.jogador}${sub}</span>
        </div>`;
      }).join('')}
    </div>` : '';

  if (!clicavel) return inner + ticker;
  return `<div class="jogo-bloco" data-espn="${espnId}" data-t1="${j.t1}" data-t2="${j.t2}">${inner}${ticker}<div class="jogo-detalhe" hidden></div></div>`;
}

function cartao(titulo, conteudo, extra = '') {
  return `<div class="cartao">
    ${titulo ? `<div class="cartao-cabecalho"><span>${titulo}</span>${extra}</div>` : ''}
    ${conteudo}
  </div>`;
}

/* ---------- TELA: HOJE ---------- */
function renderHoje() {
  const tela = $('#tela-hoje');
  const agora = agoraBRT();
  const h = agora.getUTCHours();
  const periodo = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const hoje = hojeISO();

  const proximoBR = DADOS.jogos.find(j => j.brasil && new Date(j.iso) > new Date());
  const jogosHoje = DADOS.jogos.filter(j => j.data === hoje);
  const ontem = dataBRT(new Date(Date.now() - 864e5));
  const jogosOntem = DADOS.jogos.filter(j => j.data === ontem && resultadoDe(j));

  let ingresso = '';
  if (proximoBR) {
    ingresso = `
      <div class="ingresso">
        <div class="ingresso-eyebrow">Próximo jogo do Brasil</div>
        <div class="ingresso-jogo">${proximoBR.t1} <span class="vs">x</span> ${proximoBR.t2}</div>
        <div class="ingresso-meta">${dataLonga(proximoBR.data)} · ${proximoBR.hora} (Brasília)<br>
          ${proximoBR.estadio} · ${proximoBR.cidade}</div>
        <div class="contagem" id="contagem" data-alvo="${proximoBR.iso}">
          <div><b>--</b><span>dias</span></div><div><b>--</b><span>horas</span></div>
          <div><b>--</b><span>min</span></div><div><b>--</b><span>seg</span></div>
        </div>
      </div>`;
  }

  // jogos de hoje que a API conhece mas a tabela embutida ainda mostra como
  // "Vencedor do Jogo X" (mata-mata): exibe direto com os times reais
  const casadosHoje = new Set(jogosHoje.map(j => chaveJogo(j.data, j.t1, j.t2)));
  const extrasAPI = aoVivoHoje.filter(v => !casadosHoje.has(chaveJogo(v.data, v.t1, v.t2)));
  const extrasHTML = extrasAPI.length ? `
    <div class="secao-titulo">Em campo agora</div>
    ${cartao('', extrasAPI.map(v => `
      <div class="jogo ${/brasil/.test(norm(v.t1 + v.t2)) ? 'do-brasil' : ''}">
        <div class="jogo-hora">${v.hora}
          ${v.estado === 'in'
            ? `<span class="vivo">${(v.detalhe || '').toLowerCase() === 'ht' ? 'intervalo' : v.detalhe || 'ao vivo'}</span>`
            : v.estado === 'post' ? '<span class="vivo" style="color:var(--giz-suave)">fim</span>' : ''}</div>
        <div class="jogo-times">
          <div class="jogo-linha"><span>${v.t1}</span><span class="gols">${v.p1 ?? ''}</span></div>
          <div class="jogo-linha"><span>${v.t2}</span><span class="gols">${v.p2 ?? ''}</span></div>
          <div class="jogo-local">${v.detalhe || ''}</div>
        </div>
        <div class="jogo-fase">Copa 2026</div>
      </div>`).join(''))}` : '';

  tela.innerHTML = `
    <p class="saudacao">${periodo}, <b>Milena</b>! ${fraseDoDia()}</p>
    ${ingresso}
    ${jogosHoje.length ? `
      <div class="secao-titulo">Jogos de hoje <small>${dataLonga(hoje)}</small></div>
      ${cartao('', jogosHoje.map(j => linhaJogo(j)).join(''))}` : ''}
    ${extrasHTML}
    ${jogosOntem.length ? `
      <div class="secao-titulo">Resultados de ontem</div>
      ${cartao('', jogosOntem.map(j => linhaJogo(j)).join(''))}` : ''}
    ${apiDisponivel === false ? `<p class="nota">Os placares ao vivo estão indisponíveis agora —
      mas a tabela completa continua aqui, sempre. Puxe para atualizar mais tarde.</p>` :
      `<p class="nota">Os placares se atualizam sozinhos a cada minuto. Horários sempre no fuso de Brasília.</p>`}
  `;
  iniciarContagem();
  iniciarDetalhes(tela);
}

function fraseDoDia() {
  const hoje = hojeISO();
  const jogoBR = DADOS.jogos.find(j => j.brasil && j.data === hoje);
  if (jogoBR) return `Hoje tem <b>Brasil</b> em campo — já separa a camisa!`;
  const n = DADOS.jogos.filter(j => j.data === hoje).length;
  if (n > 0) return `Hoje a Copa tem ${n === 1 ? 'um jogo' : n + ' jogos'} pra gente acompanhar.`;
  return `Dia sem jogos — bom pra revisar a tabela e planejar a semana da Copa.`;
}

let timerContagem = null;
function iniciarContagem() {
  clearInterval(timerContagem);
  const el = $('#contagem');
  if (!el) return;
  const alvo = new Date(el.dataset.alvo);
  const tick = () => {
    let s = Math.max(0, Math.floor((alvo - new Date()) / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600);  s -= h * 3600;
    const m = Math.floor(s / 60);    s -= m * 60;
    const b = $$('b', el);
    if (b.length === 4) [d, h, m, s].forEach((v, i) => b[i].textContent = String(v).padStart(2, '0'));
  };
  tick();
  timerContagem = setInterval(tick, 1000);
}

/* ---------- TELA: JOGOS ---------- */
let filtroAtivo = 'todos';
function renderJogos() {
  const tela = $('#tela-jogos');
  const filtros = [
    ['todos', 'Todos'], ['brasil', 'Só o Brasil'], ['grupos', 'Fase de grupos'], ['matamata', 'Mata-mata'],
  ];
  let jogos = DADOS.jogos;
  if (filtroAtivo === 'brasil')   jogos = jogos.filter(j => j.brasil);
  if (filtroAtivo === 'grupos')   jogos = jogos.filter(j => j.fase === 'grupos');
  if (filtroAtivo === 'matamata') jogos = jogos.filter(j => j.fase !== 'grupos');

  const porDia = new Map();
  for (const j of jogos) {
    if (!porDia.has(j.data)) porDia.set(j.data, []);
    porDia.get(j.data).push(j);
  }

  tela.innerHTML = `
    <div class="secao-titulo">Todos os jogos <small>104 partidas · 39 dias</small></div>
    <div class="filtros">${filtros.map(([v, r]) =>
      `<button class="chip ${v === filtroAtivo ? 'ativo' : ''}" data-filtro="${v}">${r}</button>`).join('')}</div>
    <p class="nota">No mata-mata, os confrontos aparecem como “1º do Grupo C”, “Vencedor do Jogo 76”
      etc. e vão sendo definidos conforme a Copa avança. Madrugadas (00h–01h) fecham a rodada da noite anterior.</p>
    ${[...porDia.entries()].map(([data, lista]) => `
      <div class="dia-titulo">${dataLonga(data)}</div>
      ${cartao('', lista.map(j => linhaJogo(j)).join(''))}`).join('')}
  `;
  $$('.chip', tela).forEach(c => c.addEventListener('click', () => {
    filtroAtivo = c.dataset.filtro; renderJogos(); window.scrollTo({ top: 0 });
  }));
  iniciarDetalhes(tela);
}

/* ---------- TELA: BRASIL ---------- */
function renderBrasil() {
  const tela = $('#tela-brasil');
  const jogosBR = DADOS.jogos.filter(j => j.brasil);
  const tab = classificacao('C');
  const jogou = tab.some(t => t.j > 0);

  const caminho = [
    ['Fase de 32 — Jogo 76', 'Segunda, 29/06 · 14h00', '2º do Grupo F', 'Houston'],
    ['Oitavas — Jogo 91', 'Domingo, 05/07 · 17h00', 'Vencedor de 76 x 78', 'Nova York'],
    ['Quartas — Jogo 99', 'Sábado, 11/07 · 18h00', 'Vencedor de 91 x 92', 'Miami'],
    ['Semifinal — Jogo 102', 'Quarta, 15/07 · 16h00', 'Vencedor de 99 x 100', 'Atlanta'],
    ['A GRANDE FINAL', 'Domingo, 19/07 · 16h00', '—', 'Nova York'],
  ];

  tela.innerHTML = `
    <div class="secao-titulo">A Seleção rumo ao hexa</div>
    ${cartao('Jogos do Brasil', jogosBR.map(j => linhaJogo(j)).join(''))}

    ${cartao(`Grupo C — classificação${jogou ? '' : ' (ainda sem jogos)'}`, `
      <table class="tabela">
        <thead><tr><th></th><th>Seleção</th><th class="num">P</th><th class="num">J</th>
          <th class="num">V</th><th class="num">E</th><th class="num">D</th><th class="num">SG</th></tr></thead>
        <tbody>${tab.map((t, i) => `
          <tr class="${norm(t.selecao) === 'brasil' ? 'destaque' : ''} ${i < 2 ? 'classifica' : ''}">
            <td class="num">${i + 1}º</td><td>${t.selecao}</td>
            <td class="num">${t.p}</td><td class="num">${t.j}</td><td class="num">${t.v}</td>
            <td class="num">${t.e}</td><td class="num">${t.d}</td><td class="num">${t.gp - t.gc}</td>
          </tr>`).join('')}</tbody>
      </table>
      <p class="nota" style="padding:10px 12px">Os dois primeiros avançam direto; as oito melhores
        terceiras colocadas de todos os grupos também passam. A tabela se atualiza sozinha
        conforme os jogos terminam.</p>`)}

    ${cartao('O caminho do hexa (avançando em 1º do grupo)', `
      <table class="tabela"><tbody>${caminho.map(([f, d, adv, c]) => `
        <tr><td><b style="font-family:var(--display)">${f}</b><br>
          <span class="nota">${d} · ${c}</span></td>
          <td style="text-align:right;color:var(--giz-suave);font-size:12.5px">${adv}</td></tr>`).join('')}
      </tbody></table>
      <p class="nota" style="padding:10px 12px">Passando em 2º, muda o trajeto: Jogo 75 (29/06, 22h, Monterrey),
        oitavas dia 04/07 em Houston, quartas dia 09/07 em Boston e semifinal dia 14/07 em Dallas —
        a final é a mesma, em Nova York.</p>`)}

    ${cartao('As chances do Brasil', `<div class="painel">
      <p class="prosa">O Brasil chega como <b>6º do ranking FIFA</b> e aparece entre os seis
        candidatos mais fortes em todas as projeções — modelos estatísticos dão à Seleção cerca de
        <b>6,5% de chance de título</b> (6ª maior), e nas casas de apostas só Espanha, França e
        Inglaterra têm cotações menores que as do Brasil.</p>
      <p class="prosa">Os trunfos: <b>Vini Jr. e Raphinha</b> no um contra um, a experiência de
        Casemiro, cinco estrelas no peito e <b>Carlo Ancelotti</b> no comando — o maior vencedor da
        história da Champions na sua primeira Copa como treinador. Os cuidados: as lesões de Éder
        Militão e Rodrygo no fim da preparação e o <b>Marrocos</b> logo na estreia, 7º do mundo e
        semifinalista em 2022.</p>
      <p class="prosa">Resumindo: a Espanha é a favorita do momento, com a França na cola — mas o
        Brasil está no pelotão da frente, com chances reais de levantar a taça em Nova York no dia
        19 de julho. Rumo ao hexa!</p>
      <div class="medidor">${DADOS.favoritas.map(f => {
        const v = parseFloat(f.probabilidade.replace(',', '.'));
        return `<div class="medidor-item ${norm(f.selecao) === 'brasil' ? 'brasil' : ''}">
          <span>${f.selecao}</span><i style="--w:${(v / 16 * 100).toFixed(1)}%"></i>
          <b>${f.probabilidade}</b></div>`;
      }).join('')}
      <p class="nota">Probabilidade de título segundo simulações estatísticas (maio/2026).</p></div>
    </div>`)}
  `;
  iniciarDetalhes(tela);
}

/* ---------- TELA: COPA ---------- */
function renderCopa() {
  const tela = $('#tela-copa');
  tela.innerHTML = `
    <div class="secao-titulo">A Copa em números <small>48 seleções · 3 países</small></div>
    <p class="prosa">Primeira Copa com <b>48 seleções</b> e três anfitriões — Estados Unidos, México e
      Canadá. São 104 jogos entre 11 de junho e 19 de julho. Da fase de grupos, avançam os dois
      primeiros de cada grupo e as oito melhores terceiras colocadas, abrindo o mata-mata com a
      inédita <b>Fase de 32</b>. No Brasil, dá pra assistir pela Globo, SporTV, Globoplay, SBT e
      Cazé TV (que mostra todos os 104 jogos).</p>

    <div class="secao-titulo">Grupos</div>
    ${DADOS.grupos.map(g => {
      const tab = classificacao(g.letra);
      return cartao(`Grupo ${g.letra}`, `
        <table class="tabela"><tbody>${tab.map((t, i) => `
          <tr class="${norm(t.selecao) === 'brasil' ? 'destaque' : ''}">
            <td class="num" style="width:34px">${i + 1}º</td><td>${t.selecao}</td>
            <td class="num" style="width:44px">${t.j ? t.p + ' pts' : ''}</td>
          </tr>`).join('')}</tbody></table>`);
    }).join('')}

    <div class="secao-titulo">Ranking FIFA <small>véspera da Copa</small></div>
    ${cartao('', `<table class="tabela"><tbody>${DADOS.rankingFifa.map(r => `
      <tr class="${norm(r.selecao) === 'brasil' ? 'destaque' : ''}">
        <td class="num" style="width:44px">${r.pos}</td><td>${r.selecao}</td></tr>`).join('')}
      </tbody></table>
      <p class="nota" style="padding:10px 12px">Atualizado em 10/06/2026. Entre os anfitriões:
        México em 14º, Estados Unidos em 17º e Canadá em 30º.</p>`)}

    <div class="secao-titulo">Os 16 estádios</div>
    ${cartao('', `<table class="tabela">
      <thead><tr><th>Estádio</th><th>Cidade</th><th class="num">Lugares</th></tr></thead>
      <tbody>${[...DADOS.estadios].sort((a, b) =>
        parseInt(b.capacidade.replace('.', '')) - parseInt(a.capacidade.replace('.', ''))).map(e => `
        <tr class="${e.nome.includes('MetLife') ? 'destaque' : ''}">
          <td>${e.nome}</td><td>${e.cidade} · ${e.pais}</td><td class="num">${e.capacidade}</td>
        </tr>`).join('')}</tbody></table>
      <p class="nota" style="padding:10px 12px">Capacidades aproximadas — a lotação oficial varia
        jogo a jogo. O MetLife (destacado) recebe a estreia do Brasil e a final. O Azteca se torna
        o primeiro estádio a receber três Copas (1970, 1986 e 2026), e o AT&T Stadium é o que tem
        mais jogos: nove.</p>`)}
  `;
}

/* ---------- detalhes de jogo (acordeão) ---------- */
const detalheCache = {};

async function buscarDetalhe(espnId) {
  if (detalheCache[espnId]) return detalheCache[espnId];
  try {
    const r = await fetch(`/api/detalhe?id=${espnId}`);
    const d = await r.json();
    if (d.ok) detalheCache[espnId] = d;
    return d;
  } catch { return { ok: false }; }
}

function renderDetalhe(d, t1, t2, el) {
  if (!d.ok) {
    el.innerHTML = `<p class="nota detalhe-vazio">Detalhes indisponíveis para este jogo.</p>`;
    return;
  }
  const ICO = {
    gol:      `<span class="ev-ico ev-gol"></span>`,
    pen:      `<span class="ev-ico ev-gol"></span><span class="ev-sub">pên.</span>`,
    contra:   `<span class="ev-ico ev-gol"></span><span class="ev-sub">c.g.</span>`,
    amarelo:  `<span class="ev-ico ev-amarelo"></span>`,
    vermelho: `<span class="ev-ico ev-vermelho"></span>`,
  };
  const linhaEv = ev => `
    <div class="ev-linha ${ev.eCasa ? 'ev-casa' : 'ev-fora'}">
      <span class="ev-min">${ev.minuto}</span>
      <span class="ev-tipo">${ICO[ev.tipo] || ''}</span>
      <span class="ev-nome">${ev.jogador || '—'}</span>
    </div>`;
  const statRow = (label, v1, v2) => (v1 || v2) ? `
    <tr><td class="st-val">${v1 ?? '—'}</td><td class="st-label">${label}</td><td class="st-val">${v2 ?? '—'}</td></tr>` : '';
  const s1 = d.statsCasa || {}, s2 = d.statsFora || {};
  const temStats = Object.keys(s1).length + Object.keys(s2).length > 0;
  el.innerHTML = `
    <div class="detalhe-corpo">
      ${d.eventos?.length ? `
        <div class="ev-cabecalho"><span>${t1}</span><span>${t2}</span></div>
        ${d.eventos.map(linhaEv).join('')}
      ` : `<p class="nota detalhe-vazio">Nenhum evento registrado.</p>`}
      ${temStats ? `<table class="tabela-stats">
        ${statRow('Escanteios', s1.corners, s2.corners)}
        ${statRow('Chutes a gol', s1.shotsOnTarget, s2.shotsOnTarget)}
        ${statRow('Chutes', s1.shots, s2.shots)}
        ${statRow('Posse (%)', s1.possessionPct, s2.possessionPct)}
        ${statRow('Cartões amarelos', s1.yellowCards, s2.yellowCards)}
        ${statRow('Cartões vermelhos', s1.redCards, s2.redCards)}
      </table>` : ''}
    </div>`;
}

function iniciarDetalhes(tela) {
  $$('.jogo-bloco', tela).forEach(bloco => {
    bloco.addEventListener('click', async () => {
      const painel = $('.jogo-detalhe', bloco);
      const seta = $('.btn-detalhe', bloco);
      if (!painel) return;
      const abrindo = painel.hidden;
      painel.hidden = !abrindo;
      if (seta) seta.textContent = abrindo ? '▴' : '▾';
      if (abrindo && !painel.dataset.loaded) {
        painel.innerHTML = `<p class="nota detalhe-vazio">Carregando...</p>`;
        const dados = await buscarDetalhe(bloco.dataset.espn);
        renderDetalhe(dados, bloco.dataset.t1, bloco.dataset.t2, painel);
        painel.dataset.loaded = '1';
      }
    });
  });
}

/* ---------- navegação ---------- */
const RENDER = { hoje: renderHoje, jogos: renderJogos, brasil: renderBrasil, copa: renderCopa };
let telaAtiva = 'hoje';
function renderTelaAtiva() { RENDER[telaAtiva](); }

$$('.nav-botao').forEach(b => b.addEventListener('click', () => {
  telaAtiva = b.dataset.alvo;
  $$('.nav-botao').forEach(x => x.classList.toggle('ativo', x === b));
  $$('.tela').forEach(t => t.hidden = t.dataset.tela !== telaAtiva);
  renderTelaAtiva();
  window.scrollTo({ top: 0 });
}));

/* ---------- aviso de instalação no iPhone ---------- */
(function avisoInstalar() {
  const ehIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const instalado = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (ehIOS && !instalado && !cofre.ler('copa.avisoOk')) $('#avisoInstalar').hidden = false;
  $('#fecharAviso').addEventListener('click', () => {
    $('#avisoInstalar').hidden = true; cofre.gravar('copa.avisoOk', true);
  });
})();

/* ---------- início ---------- */
renderTelaAtiva();
buscarPlacar();
setInterval(() => { if (!document.hidden) buscarPlacar(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) buscarPlacar(); });

})();
