# Backend do CafeCalc no Google Apps Script

Use este backend no mesmo Apps Script do link:

`https://script.google.com/macros/s/AKfycbw521BJUFg11TTgIZ9QpxhZH_TTkW7RpaOj8kpNRqPOb7xx4RIcg7hMdSsdMfgH92gpLQ/exec`

## Arquivos

- Cole `apps-script/Code.gs` no arquivo `Code.gs` do Apps Script.
- Crie um arquivo HTML chamado `Index` e cole nele o conteúdo de `index.html`.

## Configuração obrigatória

1. No Google Cloud do projeto do Apps Script, crie um OAuth Client ID do tipo Web.
2. Adicione em "Authorized JavaScript origins" a origem onde o app será aberto, sem caminho. Exemplos: `http://127.0.0.1:8088` para teste local ou a origem pública final do app.
3. Copie o Client ID.
4. No Apps Script, abra `Project Settings` e adicione uma Script Property:
   - Nome: `GOOGLE_CLIENT_ID`
   - Valor: o Client ID criado.
5. No `index.html`, troque `COLE_AQUI_SEU_CLIENT_ID.apps.googleusercontent.com` pelo mesmo Client ID.
6. Faça novo deploy do Apps Script como Web App.

## Segurança aplicada

- O app não usa senha própria.
- O backend só aceita token Google válido e emitido para o Client ID configurado.
- Cada linha da planilha recebe um `ownerKey` derivado do identificador Google do usuário.
- As leituras, gravações e exclusões filtram sempre pelo `ownerKey`.
- A planilha não precisa ser compartilhada com os produtores.

Observação importante: Google Sheets não é um cofre de sigilo absoluto contra o dono/admin da planilha. Para que literalmente ninguém além do produtor veja os dados, seria necessário criptografia ponta a ponta ou um banco com política de acesso por usuário.
