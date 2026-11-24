"use strict";

/*
 * Configuração e autenticação do painel administrativo.
 *
 * A senha é guardada como hash scrypt em dados/painel.json. Na primeira
 * execução uma senha aleatória é criada e impressa no console.
 * A variável de ambiente ADMIN_SENHA, quando definida, tem prioridade.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DIR_DADOS = process.env.DADOS_DIR
  ? path.resolve(process.env.DADOS_DIR)
  : path.join(__dirname, "..", "dados");
const ARQUIVO = path.join(DIR_DADOS, "painel.json");
const ARQ_SENHA_TXT = path.join(DIR_DADOS, "senha.txt");

const CARACTERES = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SESSAO_MS = 8 * 3600 * 1000;

let config = null;
let senhaInicial = null;

function gerarSenha(tamanho = 14) {
  const bytes = crypto.randomBytes(tamanho);
  let senha = "";
  for (let i = 0; i < tamanho; i++) senha += CARACTERES[bytes[i] % CARACTERES.length];
  return senha;
}

function hashSenha(senha, sal) {
  return crypto.scryptSync(String(senha), sal, 64).toString("hex");
}

function igualSeguro(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function salvar() {
  fs.mkdirSync(DIR_DADOS, { recursive: true });
  const temporario = `${ARQUIVO}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(temporario, ARQUIVO);
}

function normalizar(bruto) {
  const base = bruto && typeof bruto === "object" ? bruto : {};
  return {
    senhaSalt: String(base.senhaSalt || ""),
    senhaHash: String(base.senhaHash || ""),
    segredo: String(base.segredo || ""),
    coleta: base.coleta !== false,
    retencaoDias: Math.min(730, Math.max(7, Math.floor(Number(base.retencaoDias) || 180))),
    criadoEm: base.criadoEm || new Date().toISOString()
  };
}

function lerSenhaArquivo() {
  let texto = "";
  try {
    texto = String(fs.readFileSync(ARQ_SENHA_TXT, "utf8")).split(/\r?\n/)[0].trim();
  } catch {
    return "";
  }
  if (texto.length < 8 || texto.length > 200) {
    console.warn("[painel] dados/senha.txt ignorado: a senha precisa ter de 8 a 200 caracteres.");
    return "";
  }
  return texto;
}

function iniciar() {
  if (config) return { senhaInicial };

  let bruto = null;
  try {
    bruto = JSON.parse(fs.readFileSync(ARQUIVO, "utf8"));
  } catch {
    /* primeiro uso ou arquivo inválido */
  }

  config = normalizar(bruto);
  let mudou = false;

  if (!config.segredo || config.segredo.length < 32) {
    config.segredo = crypto.randomBytes(32).toString("hex");
    mudou = true;
  }

  const senhaDoArquivo = lerSenhaArquivo();
  if (senhaDoArquivo) {
    config.senhaSalt = crypto.randomBytes(16).toString("hex");
    config.senhaHash = hashSenha(senhaDoArquivo, config.senhaSalt);
    mudou = true;
    try {
      fs.unlinkSync(ARQ_SENHA_TXT);
    } catch {
      /* já removido */
    }
    if (senhaDoAmbiente()) {
      console.log("[painel] ADMIN_SENHA tem prioridade sobre dados/senha.txt.");
    } else {
      console.log("[painel] senha definida via dados/senha.txt; arquivo apagado por segurança.");
    }
  } else if (!config.senhaSalt || !config.senhaHash) {
    senhaInicial = gerarSenha();
    config.senhaSalt = crypto.randomBytes(16).toString("hex");
    config.senhaHash = hashSenha(senhaInicial, config.senhaSalt);
    mudou = true;
  }

  if (mudou) salvar();
  return { senhaInicial };
}

function obter() {
  if (!config) iniciar();
  return config;
}

function atualizar(mudancas) {
  config = normalizar({ ...obter(), ...mudancas });
  salvar();
  return config;
}

function senhaDoAmbiente() {
  return process.env.ADMIN_SENHA || "";
}

function aplicarSenhaPendente() {
  const atual = obter();
  const senha = lerSenhaArquivo();
  if (!senha) return;

  atual.senhaSalt = crypto.randomBytes(16).toString("hex");
  atual.senhaHash = hashSenha(senha, atual.senhaSalt);
  salvar();

  try {
    fs.unlinkSync(ARQ_SENHA_TXT);
  } catch {
    /* já removido */
  }

  if (senhaDoAmbiente()) {
    console.log("[painel] senha de dados/senha.txt gravada, mas ADMIN_SENHA tem prioridade.");
  } else {
    console.log("[painel] senha do painel atualizada via dados/senha.txt; arquivo apagado.");
  }
}

function conferirSenha(senha) {
  aplicarSenhaPendente();

  const doAmbiente = senhaDoAmbiente();
  if (doAmbiente) return igualSeguro(senha, doAmbiente);

  const atual = obter();
  if (!senha || !atual.senhaHash) return false;
  const teste = crypto.scryptSync(String(senha), atual.senhaSalt, 64);
  const alvo = Buffer.from(atual.senhaHash, "hex");
  return teste.length === alvo.length && crypto.timingSafeEqual(teste, alvo);
}

function alterarSenha(nova) {
  const atual = obter();
  atual.senhaSalt = crypto.randomBytes(16).toString("hex");
  atual.senhaHash = hashSenha(nova, atual.senhaSalt);
  salvar();
  return atual;
}

function criarToken(duracaoMs = SESSAO_MS) {
  const atual = obter();
  const expira = Date.now() + duracaoMs;
  const marca = atual.senhaHash.slice(0, 12);
  const payload = `${expira}.${marca}`;
  const assinatura = crypto.createHmac("sha256", atual.segredo).update(payload).digest("hex");
  return `${payload}.${assinatura}`;
}

function validarToken(token) {
  if (!token) return false;
  const partes = String(token).split(".");
  if (partes.length !== 3) return false;

  const [expira, marca, assinatura] = partes;
  if (!/^\d+$/.test(expira) || Number(expira) < Date.now()) return false;

  const atual = obter();
  if (marca !== atual.senhaHash.slice(0, 12)) return false;

  const esperada = crypto
    .createHmac("sha256", atual.segredo)
    .update(`${expira}.${marca}`)
    .digest("hex");
  return igualSeguro(assinatura, esperada);
}

module.exports = {
  DIR_DADOS,
  SESSAO_MS,
  iniciar,
  obter,
  atualizar,
  conferirSenha,
  alterarSenha,
  criarToken,
  validarToken,
  senhaDoAmbiente,
  gerarSenha
};
