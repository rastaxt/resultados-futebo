require("dotenv").config();
const express = require("express");
const compression = require("compression");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const TOKEN = process.env.FOOTBALL_TOKEN;
const BASE = "https://api.football-data.org/v4";
const PUBLIC_DIR = path.join(__dirname, "public");

/* Competições exibidas no site (códigos da football-data.org). */
const LIGAS = ["BSA", "PL", "PD", "SA", "BL1", "FL1", "CL", "DED", "PPL", "ELC"];

/* Total de rodadas de cada competição (temporada regular). */
const TOTAL_RODADAS = {
  BSA: 38,
  PL: 38,
  PD: 38,
  SA: 38,
  BL1: 34,
  FL1: 34,
  CL: 8, // fase de liga da Champions
  DED: 34,
  PPL: 34,
  ELC: 46
};

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_CODIGO = /^[A-Z0-9]{2,4}$/;
const RE_ID = /^\d{1,10}$/;
const CACHE_TTL = 5 * 60 * 1000;

/* Cache em memória com TTL e deduplicação de requisições em andamento. */
const cache = new Map();
const emAndamento = new Map();

class UpstreamError extends Error {
  constructor(status, detalhe) {
    super(`API ${status}${detalhe ? `: ${detalhe}` : ""}`);
    this.status = status;
  }
}

function podarCache() {
  const agora = Date.now();
  for (const [chave, item] of cache) {
    if (agora - item.at > CACHE_TTL) cache.delete(chave);
  }
  // Limite de segurança: mantém apenas os itens mais recentes.
  if (cache.size > 200) {
    const antigos = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [chave] of antigos.slice(0, cache.size - 200)) cache.delete(chave);
  }
}

async function api(pathname) {
  const hit = cache.get(pathname);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;

  if (emAndamento.has(pathname)) return emAndamento.get(pathname);

  const promessa = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(BASE + pathname, {
        headers: { "X-Auth-Token": TOKEN || "" },
        signal: ctrl.signal
      });

      if (!res.ok) {
        let detalhe = "";
        try {
          const corpo = await res.json();
          detalhe = corpo?.message || corpo?.error || "";
        } catch {
          /* corpo não-JSON */
        }
        throw new UpstreamError(res.status, detalhe);
      }

      const data = await res.json();
      cache.set(pathname, { at: Date.now(), data });
      podarCache();
      return data;
    } catch (err) {
      if (err.name === "AbortError") throw new UpstreamError(504, "tempo esgotado");
      throw err;
    } finally {
      clearTimeout(timer);
      emAndamento.delete(pathname);
    }
  })();

  emAndamento.set(pathname, promessa);
  return promessa;
}

/*
 * Busca jogos de todas as ligas. Tenta uma única chamada (economiza cota da
 * API) e cai para chamadas por competição se o plano/endpoint não aceitar.
 */
async function jogosDoPeriodo(date, dateTo) {
  try {
    const data = await api(
      `/matches?competitions=${LIGAS.join(",")}&dateFrom=${date}&dateTo=${dateTo}`
    );
    if (Array.isArray(data?.matches)) return data.matches;
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 429) throw err;
    console.warn("Chamada agrupada falhou, usando chamadas por liga:", err.message);
  }

  const grupos = await Promise.allSettled(
    LIGAS.map((code) =>
      api(`/competitions/${code}/matches?dateFrom=${date}&dateTo=${dateTo}`)
    )
  );

  const vistos = new Set();
  const matches = [];
  for (const grupo of grupos) {
    if (grupo.status !== "fulfilled") continue;
    for (const m of grupo.value?.matches || []) {
      if (!vistos.has(m.id)) {
        vistos.add(m.id);
        matches.push(m);
      }
    }
  }
  if (!matches.length && grupos.every((g) => g.status === "rejected")) {
    const motivo = grupos.find((g) => g.status === "rejected")?.reason;
    throw motivo || new UpstreamError(502, "sem dados");
  }
  return matches;
}

function dataHoje() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function responderErro(res, err) {
  const status = err instanceof UpstreamError ? err.status : 500;
  console.error("[api]", err.message);

  if (status === 429) {
    return res.status(429).json({
      error: "Muitas consultas em pouco tempo. Tente novamente em instantes.",
      code: 429
    });
  }
  if (status === 400 || status === 403 || status === 404) {
    return res.status(status).json({
      error: "Liga ou jogo indisponível no momento.",
      code: status
    });
  }
  return res.status(502).json({
    error: "Não foi possível carregar os dados agora. Tente novamente.",
    code: 502
  });
}

/* ---------- Segurança e performance ---------- */

app.disable("x-powered-by");
app.use(compression());

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' https://www.googletagmanager.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https://crests.football-data.org https://www.google-analytics.com https://www.googletagmanager.com",
      "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join("; ")
  );
  next();
});

app.use(
  express.static(PUBLIC_DIR, {
    setHeaders(res, filePath) {
      if (/\.html?$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache");
      } else if (/\.(png|jpe?g|gif|svg|ico|webp)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=2592000");
      } else if (/\.(css|js)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=3600");
      }
    }
  })
);

/* ---------- API ---------- */

app.get("/api/jogos", async (req, res) => {
  try {
    const date = RE_DATA.test(req.query.date || "") ? req.query.date : dataHoje();
    let dateTo = RE_DATA.test(req.query.dateTo || "") ? req.query.dateTo : date;
    if (dateTo < date) [date, dateTo] = [dateTo, date];

    // Limite de 10 dias por consulta (protege a cota da API).
    const limiteData = new Date(`${date}T00:00:00Z`);
    limiteData.setUTCDate(limiteData.getUTCDate() + 10);
    const limite = limiteData.toISOString().slice(0, 10);
    if (dateTo > limite) dateTo = limite;

    const matches = await jogosDoPeriodo(date, dateTo);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ matches, resultSet: { count: matches.length } });
  } catch (err) {
    responderErro(res, err);
  }
});

app.get("/api/tabela/:code", async (req, res) => {
  const code = req.params.code;
  if (!RE_CODIGO.test(code)) {
    return res.status(400).json({ error: "Código de liga inválido.", code: 400 });
  }
  try {
    const data = await api(`/competitions/${code}/standings`);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json(data);
  } catch (err) {
    responderErro(res, err);
  }
});

app.get("/api/jogo/:id", async (req, res) => {
  const id = req.params.id;
  if (!RE_ID.test(id)) {
    return res.status(400).json({ error: "Identificador de jogo inválido.", code: 400 });
  }
  try {
    const data = await api(`/matches/${id}`);
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json(data);
  } catch (err) {
    responderErro(res, err);
  }
});

app.get("/api/rodada/:code", async (req, res) => {
  const code = req.params.code;
  if (!RE_CODIGO.test(code)) {
    return res.status(400).json({ error: "Código de liga inválido.", code: 400 });
  }

  try {
    const totalRodadas = TOTAL_RODADAS[code] || 38;
    const tabela = await api(`/competitions/${code}/standings`);
    const atual = tabela?.season?.currentMatchday || 1;

    const pedida = Number(req.query.rodada);
    const alvo = Number.isFinite(pedida) && pedida >= 1 ? pedida : atual;
    const rodada = Math.min(Math.max(Math.floor(alvo), 1), totalRodadas);

    const data = await api(`/competitions/${code}/matches?matchday=${rodada}`);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({
      ...data,
      rodadaAtual: atual,
      rodada,
      totalRodadas
    });
  } catch (err) {
    responderErro(res, err);
  }
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Rota não encontrada." });
});

app.listen(PORT, () => {
  console.log(`XTscores no ar em http://localhost:${PORT}`);
  if (!TOKEN) console.warn("Aviso: FOOTBALL_TOKEN não definido no .env");
});
