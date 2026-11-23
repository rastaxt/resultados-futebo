# XTscores

Placares ao vivo, jogos do dia e classificação dos principais campeonatos de futebol.

- **Backend:** Node.js + Express (proxy para a API football-data.org v4)
- **Frontend:** HTML, CSS e JavaScript puro (sem build)
- **Dados:** [football-data.org](https://www.football-data.org/)

## Requisitos

- Node.js **18 ou superior** (usa `fetch` nativo)
- Token gratuito da football-data.org

## Como rodar

```bash
npm install
cp .env.example .env     # Windows: copy .env.example .env
# edite o .env e coloque seu FOOTBALL_TOKEN
npm start
```

Acesse http://localhost:3000.

### Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `FOOTBALL_TOKEN` | sim | Token da football-data.org |
| `PORT` | não | Porta do servidor (padrão `3000`) |

## Endpoints

| Rota | Descrição |
|---|---|
| `GET /api/jogos?date=YYYY-MM-DD&dateTo=YYYY-MM-DD` | Jogos de todas as ligas no período |
| `GET /api/rodada/:code?rodada=N` | Jogos de uma rodada + metadados (`rodadaAtual`, `totalRodadas`) |
| `GET /api/tabela/:code` | Classificação da liga |
| `GET /api/jogo/:id` | Detalhes de um jogo (gols, status) |

`code` aceita `BSA`, `PL`, `PD`, `SA`, `BL1`, `FL1`, `CL`, `DED`, `PPL` e `ELC`.

## Estrutura

```
server.js              # Express: proxy com cache (5 min), validação e segurança
public/
  index.html           # Página principal
  app.js               # Lógica de jogos, tabela, rodadas e modal
  consent.js           # Banner de cookies (LGPD) + Google Analytics condicional
  style.css            # Estilos (desktop e mobile)
  politica.html        # Política de dados e cookies
  contato.html         # Contato
```

## Notas técnicas

- **Cota da API:** o plano gratuito da football-data.org permite 10 requisições/minuto. O servidor
  tenta buscar todas as ligas em **uma única chamada** (`/v4/matches?competitions=...`) e só usa
  chamadas por liga como fallback. Os resultados ficam em cache por 5 minutos.
- **Fuso horário:** todas as datas exibidas e filtradas usam `America/Sao_Paulo`.
- **Cookies:** o Google Analytics só é carregado após o consentimento do usuário.
- **Cache HTTP:** arquivos estáticos ficam 7 dias em cache; o HTML é sempre revalidado.

## Deploy

Qualquer host que rode Node.js (Render, Railway, Fly.io, VPS). Configure `FOOTBALL_TOKEN` e `PORT`
nas variáveis de ambiente do provedor. Com proxy/Nginx na frente, habilite HTTPS e repasse o header
`X-Forwarded-Proto`.

## Licença e créditos

Dados fornecidos pela football-data.org, sujeitos aos termos do provedor.
