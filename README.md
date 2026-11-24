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
| `HOST` | não | Interface de escuta (padrão `0.0.0.0`; use `127.0.0.1` para testar localmente) |
| `ADMIN_SENHA` | não | Define a senha do painel. Quando presente, tem prioridade sobre a senha gravada e desativa a troca pelo painel |
| `DADOS_DIR` | não | Pasta onde as estatísticas e a senha são gravadas (padrão `./dados`) |
| `TRUST_PROXY` | não | Confia em `X-Real-IP`/`X-Forwarded-For`. Por padrão só confia quando a conexão chega de um proxy local (loopback/rede privada); use `1` ou `0` para forçar |
| `API_MAX_MIN` | não | Limite de requisições por minuto e por IP nas rotas públicas da API (padrão `120`; `0` desativa) |
| `GEO_MAX_DIA` | não | Limite diário **total** de consultas de cidade/estado (padrão `3000`; `0` desativa) |
| `GEO_MAX_DIA_IP` | não | Limite diário de consultas de cidade/estado **por visitante** (padrão `40`) |

## Painel administrativo

O painel fica em **https://xtscores.com.br/admin**. Mostra estatísticas próprias do site, sem cookies e
sem guardar o IP. A primeira execução cria a senha automaticamente e imprime no console:

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

### Definir a senha sem terminal (hPanel, cPanel, FTP)

Se você não tem acesso ao terminal do servidor:

1. Crie o arquivo `dados/senha.txt` (na pasta do app, ao lado de `server.js`) contendo a nova
   senha em uma única linha, com 8 a 200 caracteres.
2. Tente entrar no painel com essa senha. O servidor aplica a senha na hora e **apaga o
   `dados/senha.txt` automaticamente** — não é preciso reiniciar.

A variável `ADMIN_SENHA` continua tendo prioridade. Para conferir se ela está ativa no servidor,
acesse `/api/admin/sessao`: `senhaAmbiente: true` significa que a senha vem do ambiente.

O painel tem quatro seções:

- **Visão geral:** visualizações, visitantes, sessões, tempo médio, rejeição e rolagem, com comparação
  ao período anterior; gráfico por dia (ou por hora em "Hoje"), horários de pico, páginas, origens,
  **cidades e estados** (estimados pelo IP, sem gravar o endereço), dispositivos, navegadores,
  sistemas, ligas e jogos mais abertos. O cartão **Localização do tráfego** traz visitas localizadas,
  cobertura, cidades/estados distintos, um mapa de calor por UF e o ranking de cidades e estados.
- **Tempo real:** pessoas navegando nos últimos 5 minutos, páginas abertas, cidades e estados de quem
  está no site e feed de eventos (10 s), com a cidade/UF estimada de cada visita.
- **Conteúdo:** tabelas completas de páginas, origens, eventos, ligas, países, cidades e estados.
- **Configurações:** ligar/desligar a coleta e a estimativa de localização, retenção (30 a 730 dias),
  exportação em CSV, troca de senha e exclusão de dados.

### Como a coleta funciona

- Sem cookies de análise: o visitante é identificado por um hash diário de IP + navegador + segredo.
  O IP original **não é armazenado**.
- **Cidade e estado:** estimados no momento da visita por uma consulta ao `ipwho.is`, com timeout de
  1,2 s, cache em memória por hash do IP e limites diários: `GEO_MAX_DIA_IP` por visitante (padrão 40)
  e `GEO_MAX_DIA` no total do site (padrão 3000). A UF vem de `region_code`. Se
  `X-Real-IP`/`X-Forwarded-For` já vierem com cidade/estado (CDN), a consulta é dispensada. Pode ser
  desligado em Configurações ou com `GEO_MAX_DIA=0`.
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
| `GET /api/health` | Verificação simples de saúde do processo (uptime e tamanho do cache) |
| `POST /api/track` | Coleta anônima de página vista, saída e eventos (público) |
| `GET /admin` | Painel administrativo (exige senha) |
| `POST /api/admin/entrar` · `POST /api/admin/sair` | Login e logout do painel |
| `GET /api/admin/resumo?dias=1\|7\|30\|90` | KPIs, séries e listas agregadas |
| `GET /api/admin/tempo-real` | Visitantes ativos e últimos eventos |
| `GET`/`POST /api/admin/config` | Ler e salvar coleta e retenção |
| `POST /api/admin/senha` | Trocar a senha do painel |
| `GET /api/admin/exportar?tipo=resumo\|paginas\|eventos\|localidades\|bruto&dias=N` | Exportar CSV |
| `POST /api/admin/limpar` | Apagar dados antigos ou todos (confirmação `APAGAR`) |

## Estrutura

```
server.js              # Express: proxy com cache (5 min), validação e segurança
lib/
  analytics.js         # Coleta, agregação, retenção e exportação em CSV
  geo.js               # Cidade/estado via ipwho.is, sem gravar o IP
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
- **Cache HTTP:** imagens ficam 30 dias em cache, CSS/JS 1 hora e o HTML é sempre revalidado.
- **Limites:** as rotas públicas da API aceitam `API_MAX_MIN` requisições por minuto por IP e só
  respondem ligas conhecidas. Headers de proxy (`X-Real-IP`/`X-Forwarded-For`) só são usados quando a
  conexão vem de um proxy local, salvo se `TRUST_PROXY` for definido.

## Deploy

Qualquer host que rode Node.js (Render, Railway, Fly.io, VPS). Configure `FOOTBALL_TOKEN` e `PORT`
nas variáveis de ambiente do provedor. Com proxy/Nginx na frente, habilite HTTPS e repasse o header
`X-Forwarded-Proto`.

Para o painel, defina `ADMIN_SENHA` (ou use a senha gerada no primeiro start) e aponte `DADOS_DIR`
para um **volume persistente**, senão o histórico de estatísticas é perdido a cada deploy.

## Licença e créditos

Dados fornecidos pela football-data.org, sujeitos aos termos do provedor.
