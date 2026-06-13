# A Copa da Milena 🏆

PWA personalizado para a Milena acompanhar a Copa do Mundo 2026 no iPhone:
todos os 104 jogos no horário de Brasília, placares ao vivo, classificação dos
grupos calculada automaticamente e o caminho do Brasil até a final.

## Como funciona (resumo da arquitetura)

| Camada | O quê | Custo |
|---|---|---|
| **Front (vanilla JS)** | Tabela completa dos 104 jogos embutida em `js/dados.js`. O app funciona 100% offline. | R$ 0 |
| **`/api/placar`** | Função serverless da Vercel que busca placares em um endpoint público de resultados (ESPN) e devolve JSON limpo. Cache de 45 s na borda. | R$ 0 (plano Hobby) |
| **Service worker** | Guarda o "casco" do app em cache — abre instantâneo e sem internet. | R$ 0 |

O front consulta `/api/placar` a cada 60 segundos (só com a aba visível),
acumula os resultados encerrados no armazenamento local e **recalcula a
classificação de cada grupo sozinho**. Se a API cair, nada quebra: o app
continua com a tabela completa, só sem o placar ao vivo.

## Deploy na Vercel (5 minutos)

1. Crie um repositório com esta pasta (ou use `vercel` via CLI).
2. Na Vercel: **Add New → Project → importe o repositório**.
3. Framework preset: **Other**. Não precisa de build — é estático + `/api`.
4. Deploy. Pronto: `https://seu-projeto.vercel.app`.

> A pasta `api/` é detectada automaticamente pela Vercel como serverless
> function (Node 18+, que já tem `fetch` nativo).

### Teste rápido depois do deploy

```
https://seu-projeto.vercel.app/api/placar?data=20260613
```

Deve devolver `{"ok":true,"jogos":[...]}` com os jogos do dia 13/06
(estreia do Brasil). Se um dia o endpoint da ESPN mudar, só é preciso
ajustar `api/placar.js` — o front não muda.

## Instalação no iPhone da Milena

1. Abrir o link no **Safari**;
2. Tocar no botão **Compartilhar** (quadrado com seta);
3. **"Adicionar à Tela de Início"**.

O app ganha ícone próprio, abre em tela cheia (sem barra do navegador) e
funciona offline. O próprio app mostra esse passo a passo na primeira visita.

## Estrutura

```
copa-da-milena/
├── index.html            # casco do app (4 abas: Hoje, Jogos, Brasil, Copa)
├── css/estilo.css        # design: gramado noturno + giz + amarelo
├── js/dados.js           # os 104 jogos, grupos, estádios, ranking (gerado e validado)
├── js/app.js             # renderização, contagem regressiva, ao vivo, classificação
├── api/placar.js         # serverless: placares ao vivo
├── sw.js                 # offline
├── manifest.webmanifest  # PWA
└── icons/                # ícones 180/192/512
```

## Manutenção durante a Copa

- **Nada a fazer no dia a dia** — placares e classificação se atualizam sozinhos.
- Se quiser corrigir/forçar um resultado manualmente, edite o jogo em
  `js/dados.js` (`p1`, `p2`, `fim: true`) e faça redeploy.
- Os confrontos do mata-mata ficam como "Vencedor do Jogo X" no calendário;
  quando os jogos reais acontecem, a aba **Hoje** mostra os times reais
  vindos da API automaticamente.
