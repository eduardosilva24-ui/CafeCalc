# Backend do CafeCalc no Google Apps Script

Use este backend no mesmo Apps Script do link:

`https://script.google.com/macros/s/AKfycbw521BJUFg11TTgIZ9QpxhZH_TTkW7RpaOj8kpNRqPOb7xx4RIcg7hMdSsdMfgH92gpLQ/exec`

## Arquivos

- Cole `apps-script/Code.gs` no arquivo `Code.gs` do Apps Script.
- Crie um arquivo HTML chamado `Index` e cole nele o conteúdo de `index.html`.
- Faça um novo deploy do Apps Script como Web App depois de qualquer mudança.

## Deploy seguro

1. Mantenha a planilha privada. Não compartilhe a planilha com produtores.
2. No deploy do Web App, use:
   - **Execute as:** você, dono do projeto.
   - **Who has access:** qualquer pessoa, se o site público precisar permitir cadastro.
3. O produtor acessa pelo site, cria uma conta com e-mail e senha, e os dados são salvos na planilha pelo backend.
4. A planilha terá as abas `usuarios`, `sessoes`, `lancamentos` e `auditoria`.

## Segurança aplicada

- Não usa login Google.
- A senha nunca é salva aberta: o backend grava `passwordSalt` e `passwordHash`.
- O e-mail também não fica aberto na planilha; ele é usado como hash e aparece apenas mascarado.
- Cada sessão gera um token temporário, salvo como hash na aba `sessoes`.
- A sessão dura 12 horas e pode ser encerrada pelo botão **Sair**.
- Depois de 5 tentativas erradas, a conta é bloqueada por 15 minutos.
- Cada lançamento recebe um `ownerKey`, e todas as leituras, gravações e exclusões filtram por esse dono.
- Um produtor não consegue listar, alterar ou apagar lançamentos de outro produtor pelo backend.

Observação importante: Google Sheets não é um cofre contra o dono/admin da planilha. Para impedir até o administrador de ver os dados, seria necessário criptografia ponta a ponta ou banco com política de acesso por usuário.
