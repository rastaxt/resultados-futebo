"use strict";

/*
 * Rotas de coleta de estatísticas e do painel administrativo.
 */

const express = require("express");
const path = require("path");
const crypto = require("crypto");

const COOKIE = "xt_painel";
const JANELA_LOGIN_MS = 15 * 60 * 1000;
const MAX_TENTATIVAS = 6;
const EVENTOS_PERMITIDOS = new Set([
  "liga",
  "rodada",
  "ao_vivo",
  "jogo_aberto",
  "whatsapp",
  "palpite",
  "tema",
  "busca",
  "compartilhar",
  "tabela"
]);

const UA_BOT =
  /bot|crawl|spider|slurp|headless|preview|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|axios|node-fetch|facebookexternalhit|embedly/i;

const limiterLogin = new Map();
const limiterTrack = new Map();

/* ---------- Utilidades HTTP ---------- */

function lerCookie(req, nome) {
  const bruto = req.headers.cookie || "";
  for (const parte of bruto.split(";")) {
    const corte = parte.indexOf("=");
    if (corte < 0) continue;
    if (parte.slice(0, corte).trim() !== nome) continue;
    try {
      return decodeURIComponent(parte.slice(corte + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function usarHttps(req) {
  if (req.secure) return true;
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return proto === "https";
}

function definirCookie(req, res, token) {
  const partes = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=28800"
  ];
  if (usarHttps(req)) partes.push("Secure");
  res.setHeader("Set-Cookie", partes.join("; "));
}

function limparCookie(req, res) {
  const partes = [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (usarHttps(req)) partes.push("Secure");
  res.setHeader("Set-Cookie", partes.join("; "));
}

function mesmaOrigem(req) {
  const origem = req.headers.origin;
  if (!origem) return true;
  try {
    return new URL(origem).host === req.headers.host;
  } catch {
    return false;
  }
}

function ipDoReq(req) {
  const encaminhado = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  if (encaminhado) return encaminhado;
  return req.socket?.remoteAddress || "";
}

function podarMapa(mapa, limite = 3000) {
  if (mapa.size <= limite) return;
  for (const chave of mapa.keys()) {
    if (mapa.size <= limite) break;
    mapa.delete(chave);
  }
}

/* ---------- Limites de uso ---------- */

function podeTentarLogin(ip) {
  const agora = Date.now();
  const registro = limiterLogin.get(ip);
  if (!registro) return true;

  if (registro.bloqueadoAte && registro.bloqueadoAte > agora) return false;
  if (agora - registro.inicio > JANELA_LOGIN_MS) {
    limiterLogin.delete(ip);
    return true;
  }
  return registro.tentativas < MAX_TENTATIVAS;
}

function falhouLogin(ip) {
  const agora = Date.now();
  const registro = limiterLogin.get(ip);
  if (!registro || agora - registro.inicio > JANELA_LOGIN_MS) {
    limiterLogin.set(ip, { inicio: agora, tentativas: 1, bloqueadoAte: 0 });
  } else {
    registro.tentativas++;
    if (registro.tentativas >= MAX_TENTATIVAS) registro.bloqueadoAte = agora + JANELA_LOGIN_MS;
  }
  podarMapa(limiterLogin, 1000);
}

function liberarTrack(ip) {
  const agora = Date.now();
  let janela = limiterTrack.get(ip);
  if (!janela || agora - janela.inicio > 60000) {
    janela = { inicio: agora, total: 0 };
    limiterTrack.set(ip, janela);
  }
  janela.total++;
  podarMapa(limiterTrack, 3000);
  return janela.total <= 240;
}

/* ---------- Normalização dos dados ---------- */

function limparTexto(valor, tamanho) {
  return String(valor ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, tamanho);
}

function normalizarRota(valor) {
  let rota = limparTexto(valor, 120).split("?")[0].split("#")[0];
  if (!rota) rota = "/";
  if (!rota.startsWith("/")) rota = `/${rota}`;
  if (rota.startsWith("//")) rota = rota.replace(/^\/+/, "/");
  if (!/^\/[A-Za-z0-9._\-/]*$/.test(rota)) rota = "/";
  return rota.slice(0, 80);
}

function hostAtual(req) {
  return String(req.headers.host || "")
    .split(":")[0]
    .replace(/^www\./i, "")
    .toLowerCase();
}

function hostDe(valor, req) {
  try {
    const url = new URL(String(valor));
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (!host || host === hostAtual(req)) return "";
    return host.slice(0, 60);
  } catch {
    return "";
  }
}

function navegadorDe(agente) {
  if (/Edg\//.test(agente)) return "Edge";
  if (/OPR\/|Opera/.test(agente)) return "Opera";
  if (/SamsungBrowser/.test(agente)) return "Samsung Internet";
  if (/Firefox|FxiOS/.test(agente)) return "Firefox";
  if (/CriOS|Chrome/.test(agente)) return "Chrome";
  if (/Safari/.test(agente)) return "Safari";
  return "Outro";
}

function sistemaDe(agente) {
  if (/Android/.test(agente)) return "Android";
  if (/iPhone|iPad|iPod/.test(agente)) return "iOS";
  if (/Windows/.test(agente)) return "Windows";
  if (/Mac OS X|Macintosh/.test(agente)) return "macOS";
  if (/Linux/.test(agente)) return "Linux";
  return "Outro";
}

function dispositivoDe(agente) {
  if (/SmartTV|HbbTV|PlayStation|Xbox|Nintendo/i.test(agente)) return "TV/Console";
  if (/iPad|Tablet|PlayBook|Silk/i.test(agente)) return "Tablet";
  if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(agente)) return "Celular";
  return "Computador";
}

function paisDe(req) {
  const bruto = String(
    req.headers["cf-ipcountry"] ||
      req.headers["x-vercel-ip-country"] ||
      req.headers["x-country-code"] ||
      req.headers["x-geo-country"] ||
      ""
  ).toUpperCase();
  if (!/^[A-Z]{2}$/.test(bruto)) return "";
  if (bruto === "XX" || bruto === "T1") return "";
  return bruto;
}

/* ---------- Coleta ---------- */

function montarColeta(app, analytics, painel) {
  const json = express.json({ limit: "4kb" });

  app.post("/api/track", json, async (req, res) => {
    res.status(204);

    const config = painel.obter();
    if (!config.coleta) return res.end();

    if (String(req.headers.dnt || "") === "1" || String(req.headers["sec-gpc"] || "") === "1") {
      return res.end();
    }

    const agente = String(req.headers["user-agent"] || "").slice(0, 500);
    if (!agente || UA_BOT.test(agente)) return res.end();

    const ip = ipDoReq(req);
    if (!liberarTrack(ip)) return res.end();

    const corpo = req.body;
    if (!corpo || typeof corpo !== "object") return res.end();

    const tipo = String(corpo.t || "");
    if (tipo !== "pageview" && tipo !== "saida" && tipo !== "evento") return res.end();

    const rota = normalizarRota(corpo.r);
    if (rota.startsWith("/admin") || rota.startsWith("/api/")) return res.end();

    const sessao = /^[a-f0-9]{16,32}$/.test(String(corpo.s || ""))
      ? String(corpo.s)
      : crypto.randomBytes(12).toString("hex");

    const ts = Date.now();
    const registro = {
      ts,
      t: tipo,
      ses: sessao,
      vis: analytics.hashVisitante(ip, agente, analytics.diaSP(ts)),
      rota,
      ref: tipo === "pageview" ? hostDe(corpo.ref, req) : "",
      disp: dispositivoDe(agente),
      nav: navegadorDe(agente),
      so: sistemaDe(agente),
      pais: paisDe(req)
    };

    if (tipo === "saida") {
      const duracao = Number(corpo.dur);
      const rolagem = Number(corpo.rol);
      if (Number.isFinite(duracao) && duracao > 0) registro.dur = Math.min(Math.round(duracao), 6 * 3600 * 1000);
      if (Number.isFinite(rolagem)) registro.rol = Math.min(Math.max(Math.round(rolagem), 0), 100);
      if (registro.dur == null && registro.rol == null) return res.end();
    }

    if (tipo === "evento") {
      const nome = limparTexto(corpo.n, 40);
      if (!EVENTOS_PERMITIDOS.has(nome)) return res.end();
      registro.n = nome;
      registro.v = limparTexto(corpo.v, 80);
      registro.c = limparTexto(corpo.c, 80);
    }

    try {
      await analytics.registrar(registro);
    } catch {
      /* nunca expõe erro de gravação ao visitante */
    }
    res.end();
  });
}

/* ---------- Painel ---------- */

function montarPainel(app, analytics, painel) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    next();
  });

  router.use(express.json({ limit: "8kb" }));

  router.get("/sessao", (req, res) => {
    const autenticado = painel.validarToken(lerCookie(req, COOKIE));
    res.json({
      autenticado,
      senhaAmbiente: Boolean(painel.senhaDoAmbiente())
    });
  });

  router.post("/entrar", (req, res) => {
    const ip = ipDoReq(req);

    if (!mesmaOrigem(req)) {
      return res.status(403).json({ error: "Origem não permitida." });
    }
    if (!podeTentarLogin(ip)) {
      return res.status(429).json({ error: "Muitas tentativas. Aguarde 15 minutos." });
    }

    const senha = limparTexto(req.body?.senha, 200);
    if (!senha || !painel.conferirSenha(senha)) {
      falhouLogin(ip);
      return res.status(401).json({ error: "Senha incorreta." });
    }

    limiterLogin.delete(ip);
    definirCookie(req, res, painel.criarToken());
    res.json({ ok: true });
  });

  router.post("/sair", (req, res) => {
    limparCookie(req, res);
    res.json({ ok: true });
  });

  /* Daqui para baixo, tudo exige sessão válida. */
  router.use((req, res, next) => {
    if (!painel.validarToken(lerCookie(req, COOKIE))) {
      return res.status(401).json({ error: "Sessão expirada. Entre novamente." });
    }
    if (req.method !== "GET" && req.method !== "HEAD" && !mesmaOrigem(req)) {
      return res.status(403).json({ error: "Origem não permitida." });
    }
    next();
  });

  router.get("/resumo", async (req, res) => {
    try {
      const dias = [1, 7, 30, 90].includes(Number(req.query.dias)) ? Number(req.query.dias) : 7;
      const [atual, anterior] = await Promise.all([
        analytics.agregarPeriodo(dias),
        analytics.agregarPeriodo(dias, 1)
      ]);

      const variacao = (valor, base) => {
        if (!base) return valor > 0 ? 100 : 0;
        return Number((((valor - base) / base) * 100).toFixed(1));
      };

      const kpis = {};
      for (const chave of [
        "visualizacoes",
        "visitantes",
        "sessoes",
        "duracaoMedia",
        "rejeicao",
        "rolagemMedia"
      ]) {
        kpis[chave] = {
          valor: atual.kpis[chave],
          anterior: anterior.kpis[chave],
          variacao: variacao(atual.kpis[chave], anterior.kpis[chave])
        };
      }

      res.json({
        ...atual,
        kpis,
        tempoReal: analytics.tempoReal(),
        atualizadoEm: new Date().toISOString()
      });
    } catch (err) {
      console.error("[painel] resumo:", err.message);
      res.status(500).json({ error: "Não foi possível calcular as estatísticas." });
    }
  });

  router.get("/tempo-real", (req, res) => {
    res.json({ ...analytics.tempoReal(), atualizadoEm: new Date().toISOString() });
  });

  router.get("/config", (req, res) => {
    const config = painel.obter();
    res.json({
      coleta: config.coleta,
      retencaoDias: config.retencaoDias,
      senhaAmbiente: Boolean(painel.senhaDoAmbiente()),
      criadoEm: config.criadoEm
    });
  });

  router.post("/config", async (req, res) => {
    const mudancas = {};
    if (typeof req.body?.coleta === "boolean") mudancas.coleta = req.body.coleta;

    const retencao = Number(req.body?.retencaoDias);
    if (Number.isFinite(retencao)) {
      mudancas.retencaoDias = Math.min(730, Math.max(7, Math.floor(retencao)));
    }

    if (!Object.keys(mudancas).length) {
      return res.status(400).json({ error: "Nada para atualizar." });
    }

    const config = painel.atualizar(mudancas);
    if (mudancas.retencaoDias) {
      await analytics.limparAnteriores(config.retencaoDias).catch(() => 0);
    }

    res.json({
      ok: true,
      coleta: config.coleta,
      retencaoDias: config.retencaoDias
    });
  });

  router.post("/senha", (req, res) => {
    if (painel.senhaDoAmbiente()) {
      return res.status(400).json({
        error: "A senha é definida pela variável ADMIN_SENHA. Altere-a no servidor para trocar."
      });
    }

    const atual = String(req.body?.atual || "");
    const nova = String(req.body?.nova || "");

    if (!painel.conferirSenha(atual)) {
      falhouLogin(ipDoReq(req));
      return res.status(401).json({ error: "Senha atual incorreta." });
    }
    if (nova.length < 8 || nova.length > 200) {
      return res.status(400).json({ error: "A nova senha precisa ter entre 8 e 200 caracteres." });
    }

    painel.alterarSenha(nova);
    definirCookie(req, res, painel.criarToken());
    res.json({ ok: true });
  });

  router.get("/exportar", async (req, res) => {
    const dias = [1, 7, 30, 90, 365].includes(Number(req.query.dias)) ? Number(req.query.dias) : 30;
    const tipo = ["resumo", "paginas", "eventos", "bruto"].includes(String(req.query.tipo))
      ? String(req.query.tipo)
      : "resumo";

    try {
      let conteudo;
      if (tipo === "paginas") conteudo = await analytics.exportarPaginasCSV(dias);
      else if (tipo === "eventos") conteudo = await analytics.exportarEventosCSV(dias);
      else if (tipo === "bruto") conteudo = await analytics.exportarBrutoCSV(dias);
      else conteudo = await analytics.exportarResumoCSV(dias);

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="xtscores-${tipo}-${analytics.diaSP()}.csv"`
      );
      res.send(`\uFEFF${conteudo}`);
    } catch (err) {
      console.error("[painel] exportar:", err.message);
      res.status(500).json({ error: "Não foi possível gerar o arquivo." });
    }
  });

  router.post("/limpar", async (req, res) => {
    if (String(req.body?.confirmar || "").toUpperCase() !== "APAGAR") {
      return res.status(400).json({ error: 'Digite "APAGAR" para confirmar.' });
    }

    try {
      let removidos;
      if (req.body?.tudo === true) {
        removidos = await analytics.limparTudo();
      } else {
        const dias = Math.min(3650, Math.max(0, Math.floor(Number(req.body?.dias) || 0)));
        removidos = await analytics.limparAnteriores(dias);
      }
      res.json({ ok: true, removidos });
    } catch (err) {
      console.error("[painel] limpar:", err.message);
      res.status(500).json({ error: "Não foi possível apagar os dados." });
    }
  });

  router.use((req, res) => {
    res.status(404).json({ error: "Rota não encontrada." });
  });

  app.use("/api/admin", router);

  app.get("/admin", (req, res) => {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
  });
}

module.exports = { montarColeta, montarPainel };
