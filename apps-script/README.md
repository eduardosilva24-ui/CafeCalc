# Backend do CafeCalc Rural no Google Apps Script

Use este backend no mesmo Apps Script do link:

`https://script.google.com/macros/s/AKfycbw521BJUFg11TTgIZ9QpxhZH_TTkW7RpaOj8kpNRqPOb7xx4RIcg7hMdSsdMfgH92gpLQ/exec`

## Arquivos

- Cole `apps-script/Code.gs` no arquivo `Code.gs` do Apps Script.
- Crie ou atualize um arquivo HTML chamado `Index` com o conteúdo de `index.html`.
- Faça um novo deploy do Apps Script como Web App depois de qualquer mudança.

## Deploy recomendado

1. Mantenha a planilha privada.
2. No deploy do Web App, use:
   - **Execute as:** você, dono do projeto.
   - **Who has access:** qualquer pessoa, se o site público precisar permitir cadastro.
3. O produtor acessa pelo site, cria uma conta com e-mail e senha, aceita o termo e usa a Área do Produtor.

## Segurança aplicada

- O cadastro e login são feitos pelo próprio site.
- A senha não é salva aberta: o backend grava apenas `passwordSalt` e `passwordHash`.
- O e-mail é usado como hash e exibido apenas mascarado.
- Cada sessão gera um token temporário, salvo como hash.
- Depois de 5 tentativas erradas, a conta é bloqueada por 15 minutos.
- Cada lançamento recebe `ownerKey`, e leituras, gravações e exclusões filtram por esse produtor.
- Os dados financeiros são criptografados no navegador com AES-GCM antes de chegar ao backend.
- A aba `lancamentos` guarda apenas `id`, `ownerKey`, datas técnicas e o envelope criptografado.

## Migração importante

Versões antigas salvavam lançamentos financeiros em colunas abertas. Para cumprir a proposta de dados ilegíveis na planilha, limpe ou arquive com segurança os lançamentos antigos antes de usar esta versão em produção, ou peça que o produtor reimporte as informações pela nova Área do Produtor.
