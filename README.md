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
| `ADMIN_SENHA` | não | Define a senha do painel. Quando presente, tem prioridade sobre a senha gravada e desativa a troca pelo painel |
| `DADOS_DIR` | não | Pasta onde as estatísticas e a senha são gravadas (padrão `./dados`) |

## Painel administrativo

O painel fica em **`/admin`** e mostra estatísticas próprias do site, sem cookies e sem guardar o IP.
A primeira execução cria a senha automaticamente e imprime no console:

```
=== PAINEL XTSCORES - SENHA INICIAL ===
Senha: xxxxxxxxxxxxxx
=======================================
```

Para definir outra senha a qualquer momento:

```bash
npm run senha                 # gera uma senha aleatória
npm run senha -- "minha-senha"  # define uma senha específica
```

O painel tem quatro seções:

- **Visão geral:** visualizações, visitantes, sessões, tempo médio, rejeição e rolagem, com comparação
  ao período anterior; gráfico por dia (ou por hora em "Hoje"), horários de pico, páginas, origens,
  dispositivos, navegadores, sistemas, ligas e jogos mais abertos.
- **Tempo real:** pessoas navegando nos últimos 5 minutos, páginas abertas e feed de eventos (10 s).
- **Conteúdo:** tabelas completas de páginas, origens, eventos, ligas e países.
- **Configurações:** ligar/desligar a coleta, retenção (30 a 730 dias), exportação em CSV, troca de
  senha e exclusão de dados.

### Como a coleta funciona

- Sem cookies de análise: o visitante é identificado por um hash diário de IP + navegador + segredo.
  O IP original **não é armazenado**.
- Respeita `DNT`, `Global Privacy Control` e navegadores automatizados.
- Os registros ficam em `dados/analytics/YYYY-MM-DD.ndjson`, com retenção configurável.
- O GA4 continua separado, carregado apenas após o consentimento de cookies.

> **Persistência:** em hosts com disco efêmero (Render, Railway e similares) os arquivos de `dados/`
> somem a cada redeploy. Defina `DADOS_DIR` apontando para um volume persistente para não perder o
> histórico. Se a pasta for apagada, a senha do painel também é recriada e impressa no console.

## Endpoints

| Rota | Descrição |
|---|---|
| `GET /api/jogos?date=YYYY-MM-DD&dateTo=YYYY-MM-DD` | Jogos de todas as ligas no período |
| `GET /api/rodada/:code?rodada=N` | Jogos de uma rodada + metadados (`rodadaAtual`, `totalRodadas`) |
| `GET /api/tabela/:code` | Classificação da liga |
| `GET /api/jogo/:id` | Detalhes de um jogo (gols, status) |
| `POST /api/track` | Coleta anônima de página vista, saída e eventos (público) |
| `GET /admin` | Painel administrativo (exige senha) |
| `POST /api/admin/entrar` · `POST /api/admin/sair` | Login e logout do painel |
| `GET /api/admin/resumo?dias=1\|7\|30\|90` | KPIs, séries e listas agregadas |
| `GET /api/admin/tempo-real` | Visitantes ativos e últimos eventos |
| `GET`/`POST /api/admin/config` | Ler e salvar coleta e retenção |
| `POST /api/admin/senha` | Trocar a senha do painel |
| `GET /api/admin/exportar?tipo=resumo\|paginas\|eventos\|bruto&dias=N` | Exportar CSV |
| `POST /api/admin/limpar` | Apagar dados antigos ou todos (confirmação `APAGAR`) |

## Estrutura

```
server.js              # Express: proxy com cache (5 min), validação e segurança
lib/
  analytics.js         # Coleta, agregação, retenção e exportação em CSV
  painel.js            # Senha (scrypt), sessão HMAC e configurações
  rotas.js             # Rotas /api/track e /api/admin/*
scripts/
  senha.js             # Redefine a senha do painel (npm run senha)
public/
  index.html           # Página principal
  app.js               # Lógica de jogos, tabela, rodadas e modal
  analytics.js         # Beacon anônimo (sem cookies, respeita DNT/GPC)
  consent.js           # Banner de cookies (LGPD) + Google Analytics condicional
  style.css            # Estilos do site (desktop e mobile)
  admin.html           # Painel administrativo
  admin.css            # Estilos do painel (tema claro e escuro)
  admin.js             # Dashboard, tempo real, conteúdo e configurações
  politica.html        # Política de dados e cookies
  contato.html         # Contato
dados/                 # Estatísticas e senha do painel (fora do Git)
```

## Notas técnicas

- **Cota da API:** o plano gratuito da football-data.org permite 10 requisições/minuto. O servidor
  tenta buscar todas as ligas em **uma única chamada** (`/v4/matches?competitions=...`) e só usa
  chamadas por liga como fallback. Os resultados ficam em cache por 5 minutos.
- **Fuso horário:** todas as datas exibidas e filtradas usam `America/Sao_Paulo`.
- **Cookies:** o Google Analytics só é carregado após o consentimento do usuário. As estatísticas do
  painel são próprias, anônimas e não usam cookies.
- **Cache HTTP:** arquivos estáticos ficam 7 dias em cache; o HTML é sempre revalidado.

## Deploy

Qualquer host que rode Node.js (Render, Railway, Fly.io, VPS). Configure `FOOTBALL_TOKEN` e `PORT`
nas variáveis de ambiente do provedor. Com proxy/Nginx na frente, habilite HTTPS e repasse o header
`X-Forwarded-Proto`.

Para o painel, defina `ADMIN_SENHA` (ou use a senha gerada no primeiro start) e aponte `DADOS_DIR`
para um **volume persistente**, senão o histórico de estatísticas é perdido a cada deploy.

## Licença e créditos

Dados fornecidos pela football-data.org, sujeitos aos termos do provedor.
