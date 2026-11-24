/* XTscores — estatísticas próprias, sem cookies e sem dados pessoais */
(function () {
  "use strict";

  /* Respeita pedidos de não rastreamento e navegadores automatizados. */
  if (navigator.globalPrivacyControl || navigator.doNotTrack === "1" || window.doNotTrack === "1") return;
  if (navigator.webdriver) return;

  var CHAVE = "xt-sessao";

  function hex(bytes) {
    var arr = new Uint8Array(bytes);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(arr);
    } else {
      for (var i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
    }
    var saida = "";
    for (var j = 0; j < arr.length; j++) saida += ("0" + arr[j].toString(16)).slice(-2);
    return saida;
  }

  function idSessao() {
    try {
      var atual = sessionStorage.getItem(CHAVE);
      if (atual && /^[a-f0-9]{16,32}$/.test(atual)) return atual;
      var novo = hex(12);
      sessionStorage.setItem(CHAVE, novo);
      return novo;
    } catch (erro) {
      return hex(12);
    }
  }

  var sessao = idSessao();
  var inicio = Date.now();
  var rolagem = 0;
  var saidaEnviada = false;

  function rotaAtual() {
    return (window.location && window.location.pathname) || "/";
  }

  function enviar(dados) {
    dados.s = sessao;
    dados.r = rotaAtual();
    var corpo = JSON.stringify(dados);

    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([corpo], { type: "application/json" });
        if (navigator.sendBeacon("/api/track", blob)) return;
      }
    } catch (erro) {
      /* tenta o fallback abaixo */
    }

    try {
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: corpo,
        keepalive: true
      }).catch(function () {});
    } catch (erro) {
      /* sem conexão: ignora */
    }
  }

  function medirRolagem() {
    var altura =
      Math.max(
        document.documentElement ? document.documentElement.scrollHeight : 0,
        document.body ? document.body.scrollHeight : 0
      ) - window.innerHeight;
    var atual = altura > 0 ? Math.round((window.scrollY / altura) * 100) : 100;
    if (atual > rolagem) rolagem = atual > 100 ? 100 : atual < 0 ? 0 : atual;
  }

  enviar({
    t: "pageview",
    ref: document.referrer || "",
    vp: window.innerWidth + "x" + window.innerHeight,
    idioma: navigator.language || ""
  });

  medirRolagem();
  window.addEventListener("scroll", medirRolagem, { passive: true });

  function finalizar() {
    if (saidaEnviada) return;
    saidaEnviada = true;
    medirRolagem();
    enviar({ t: "saida", dur: Date.now() - inicio, rol: rolagem });
  }

  window.addEventListener("pagehide", finalizar);

  /* API usada pelo restante do site. */
  window.XTtrack = function (nome, valor, contexto) {
    if (!nome || saidaEnviada) return;
    enviar({
      t: "evento",
      n: String(nome),
      v: valor == null ? "" : String(valor),
      c: contexto == null ? "" : String(contexto)
    });
  };

  /* Cliques em WhatsApp / Palpite. */
  document.addEventListener(
    "click",
    function (evento) {
      var alvo = evento.target;
      var link = alvo && alvo.closest ? alvo.closest("a[href]") : null;
      if (!link) return;
      var href = link.getAttribute("href") || "";
      if (!/wa\.me|chat\.whatsapp\.com/i.test(href)) return;

      var rotulo = "WhatsApp";
      if (link.classList.contains("palpite")) rotulo = "Palpite";
      else if (link.classList.contains("whatsapp-flutuante")) rotulo = "Botao flutuante";
      else if (link.classList.contains("banner-whatsapp")) rotulo = "Banner do grupo";

      window.XTtrack("whatsapp", rotulo, rotaAtual());
    },
    true
  );
})();
