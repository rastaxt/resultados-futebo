"use strict";

/*
 * Define (ou redefine) a senha do painel administrativo.
 *
 *   npm run senha
 *   npm run senha -- "minha-senha-nova"
 */

const painel = require("../lib/painel");

painel.iniciar();

if (painel.senhaDoAmbiente()) {
  console.warn(
    "Aviso: ADMIN_SENHA está definida. Enquanto ela existir, a senha gravada no painel não será usada."
  );
}

const nova = String(process.argv[2] || painel.gerarSenha());

if (nova.length < 8) {
  console.error("A senha precisa ter pelo menos 8 caracteres.");
  process.exit(1);
}

painel.alterarSenha(nova);

console.log("");
console.log("Senha do painel atualizada:");
console.log(`  ${nova}`);
console.log("");
console.log("Guarde em local seguro. Sessões abertas serão encerradas.");
