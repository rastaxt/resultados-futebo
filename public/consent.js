/* Aviso de cookies (LGPD) + carregamento condicional do Google Analytics */
(function () {
  "use strict";

  var CHAVE = "xtscores-consent";
  var GA_ID = "G-FWNBPZRE7M";

  function ler() {
    try {
      return localStorage.getItem(CHAVE);
    } catch {
      return null;
    }
  }

  function salvar(valor) {
    try {
      localStorage.setItem(CHAVE, valor);
    } catch {
      /* modo privado / storage bloqueado */
    }
  }

  function carregarGA() {
    if (window.__gaCarregado) return;
    window.__gaCarregado = true;

    var script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    window.gtag("js", new Date());
    window.gtag("config", GA_ID, { anonymize_ip: true });
  }

  function removerBanner() {
    var banner = document.querySelector(".consent");
    if (banner) banner.remove();
  }

  function mostrarBanner() {
    if (document.querySelector(".consent")) return;

    var banner = document.createElement("div");
    banner.className = "consent";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Aviso de cookies");

    var texto = document.createElement("p");
    texto.innerHTML =
      "Usamos cookies apenas para medir a audiência do site (Google Analytics). " +
      'Você pode aceitar ou recusar. Saiba mais na <a href="/politica.html">Política de Dados e Cookies</a>.';

    var acoes = document.createElement("div");
    acoes.className = "consent-acoes";

    var recusar = document.createElement("button");
    recusar.type = "button";
    recusar.className = "consent-recusar";
    recusar.textContent = "Recusar";

    var aceitar = document.createElement("button");
    aceitar.type = "button";
    aceitar.className = "consent-aceitar";
    aceitar.textContent = "Aceitar";

    acoes.appendChild(recusar);
    acoes.appendChild(aceitar);
    banner.appendChild(texto);
    banner.appendChild(acoes);
    document.body.appendChild(banner);

    aceitar.addEventListener("click", function () {
      salvar("aceito");
      carregarGA();
      removerBanner();
    });

    recusar.addEventListener("click", function () {
      salvar("recusado");
      removerBanner();
    });
  }

  function iniciar() {
    var escolha = ler();
    if (escolha === "aceito") {
      carregarGA();
    } else if (escolha !== "recusado") {
      mostrarBanner();
    }

    var revisar = document.getElementById("revisar-cookies");
    if (revisar) {
      revisar.addEventListener("click", function () {
        window.XTscoresConsent.revisar();
      });
    }
  }

  /* Permite revisar a escolha a partir da política de privacidade. */
  window.XTscoresConsent = {
    revisar: function () {
      try {
        localStorage.removeItem(CHAVE);
      } catch {
        /* ignora */
      }
      window.location.reload();
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();
