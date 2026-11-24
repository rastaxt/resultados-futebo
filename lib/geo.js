"use strict";

/*
 * Estimativa de cidade/estado a partir do IP.
 *
 * Privacidade:
 *  - o IP nunca é gravado em disco;
 *  - o cache em memória usa apenas um hash do IP com sal aleatório;
 *  - há limite diário por IP e um limite total de segurança;
 *  - a estimativa pode ser desligada nas Configurações do painel.
 */

const crypto = require("crypto");

const PROVEDOR = "ipwho.is";
const URL_BASE = "https://ipwho.is/";
const TTL_CACHE = 12 * 3600 * 1000;
const TTL_ERRO = 10 * 60 * 1000;
const TIMEOUT_MS = 1200;
const MAX_CACHE = 4000;

function envNumero(nome, padrao) {
  const bruto = process.env[nome];
  if (bruto == null || String(bruto).trim() === "") return padrao;
  const valor = Number(bruto);
  return Number.isFinite(valor) ? Math.max(0, Math.floor(valor)) : padrao;
}

/* GEO_MAX_DIA = teto diário total do site; GEO_MAX_DIA_IP = teto diário por visitante. */
const LIMITE_TOTAL = envNumero("GEO_MAX_DIA", 3000);
const LIMITE_IP = envNumero("GEO_MAX_DIA_IP", 40);

const sal = crypto.randomBytes(16);
const cache = new Map();
const consultasPorIp = new Map();

let diaAtual = "";
let consultas = 0;
let ultimoErro = "";
let ultimoErroEm = 0;

function ipValido(ip) {
  const limpo = String(ip || "")
    .trim()
    .replace(/^::ffff:/i, "")
    .replace(/^\[|\]$/g, "");

  if (!limpo) return "";
  if (limpo === "::1" || limpo === "0.0.0.0") return "";
  if (
    /^(10\.|127\.|169\.254\.|192\.168\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|22[4-9]\.|2[3-5]\d\.)/.test(
      limpo
    )
  ) {
    return "";
  }
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(limpo)) return "";
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(limpo)) return "";

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(limpo)) return limpo;
  if (limpo.includes(":") && /^[0-9a-f:]+$/i.test(limpo)) return limpo;
  return "";
}

function chaveCache(ip) {
  return crypto
    .createHash("sha256")
    .update(sal)
    .update(ip)
    .digest("hex")
    .slice(0, 20);
}

function limpar(valor, tamanho) {
  return String(valor ?? "")
    .replace(/[\u0000-\u001f\u007f|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, tamanho);
}

function podar() {
  if (cache.size <= MAX_CACHE) return;
  const entradas = [...cache.entries()].sort((a, b) => a[1].em - b[1].em);
  for (const [chave] of entradas.slice(0, cache.size - MAX_CACHE + 500)) cache.delete(chave);
}

function podarContadores() {
  if (consultasPorIp.size <= MAX_CACHE) return;
  for (const chave of consultasPorIp.keys()) {
    if (consultasPorIp.size <= MAX_CACHE) break;
    consultasPorIp.delete(chave);
  }
}

/* Reinicia os contadores na virada do dia (fuso do site). */
function reiniciarDia(dia) {
  if (!dia || dia === diaAtual) return;
  diaAtual = dia;
  consultas = 0;
  consultasPorIp.clear();
}

/*
 * ip: endereço do visitante; dia: AAAA-MM-DD no fuso do site (reinicia os limites).
 */
async function resolver(ip, dia) {
  const alvo = ipValido(ip);
  if (!alvo) return null;

  reiniciarDia(dia);

  const agora = Date.now();
  const chave = chaveCache(alvo);
  const guardado = cache.get(chave);
  if (guardado) {
    const validade = guardado.erro ? TTL_ERRO : TTL_CACHE;
    if (agora - guardado.em < validade) {
      if (guardado.erro) return null;
      return {
        cidade: guardado.cidade,
        estado: guardado.estado,
        uf: guardado.uf || "",
        pais: guardado.pais
      };
    }
  }

  /* Consultas já respondidas pelo cache não gastam cota. */
  if (LIMITE_TOTAL > 0 && consultas >= LIMITE_TOTAL) return null;
  if (LIMITE_IP > 0 && (consultasPorIp.get(chave) || 0) >= LIMITE_IP) return null;

  consultas++;
  consultasPorIp.set(chave, (consultasPorIp.get(chave) || 0) + 1);
  podarContadores();

  try {
    const url =
      URL_BASE +
      encodeURIComponent(alvo) +
      "?fields=success,country_code,region,region_code,city";

    const resposta = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent": "XTscores/1.0 (+https://xtscores.com.br)",
        Accept: "application/json"
      }
    });

    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);

    const dados = await resposta.json();
    if (!dados || dados.success === false) {
      cache.set(chave, { erro: true, em: agora });
      podar();
      return null;
    }

    const pais = /^[A-Za-z]{2}$/.test(String(dados.country_code || ""))
      ? String(dados.country_code).toUpperCase()
      : "";
    const uf =
      pais === "BR" && /^[A-Za-z]{2}$/.test(String(dados.region_code || ""))
        ? String(dados.region_code).toUpperCase()
        : "";

    const geo = {
      cidade: limpar(dados.city, 60),
      estado: limpar(dados.region, 60),
      uf,
      pais
    };

    cache.set(chave, { ...geo, em: agora });
    podar();
    return geo;
  } catch (err) {
    ultimoErro = err && err.name === "TimeoutError" ? "tempo esgotado" : String(err.message || err).slice(0, 120);
    ultimoErroEm = agora;
    cache.set(chave, { erro: true, em: agora });
    podar();
    return null;
  }
}

function info(dia) {
  reiniciarDia(dia);

  return {
    ativo: LIMITE_TOTAL > 0,
    provedor: PROVEDOR,
    consultasHoje: consultas,
    limiteDia: LIMITE_TOTAL,
    limiteIp: LIMITE_IP,
    ipsDistintos: consultasPorIp.size,
    cache: cache.size,
    ultimoErro,
    ultimoErroEm: ultimoErroEm ? new Date(ultimoErroEm).toISOString() : ""
  };
}

module.exports = { resolver, info, ipValido };
