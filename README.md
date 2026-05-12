# CafeCalc

Calculadora rural para produtores de café com área do produtor protegida por login do próprio site.

## Segurança do login

- O cadastro e login são feitos pelo site, sem OAuth Google.
- A planilha fica privada e só o Apps Script grava/lê os dados.
- Senhas são salvas como hash com sal; não ficam abertas na planilha.
- Os lançamentos são sempre filtrados pelo `ownerKey` do produtor autenticado.

Veja as instruções completas em `apps-script/README.md`.
