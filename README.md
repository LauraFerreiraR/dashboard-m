# MOOUI · Dashboard ao vivo (versão local)

Dashboard que se conecta ao Shopify em tempo real e mostra vendas do dia + páginas mais visitadas. Roda no seu computador (localhost), sem custo e sem hospedagem online.

---

## 📦 O que vem aqui

```
mooui-dashboard/
├── servidor.js          ← ponte: conversa com o Shopify
├── dashboard.html       ← painel visual
├── .env.exemplo         ← modelo para criar seu .env
└── README.md            ← este arquivo
```

---

## 🚀 Primeira vez — configurar (5 minutos)

### Passo 1 — Criar o arquivo `.env`

Na mesma pasta do `servidor.js`, **renomeie** o arquivo `.env.exemplo` para apenas `.env` (apague o `.exemplo`).

Abra o `.env` no VS Code e preencha:

```
SHOPIFY_STORE=mooui-br
SHOPIFY_TOKEN=shpat_xxxxxxxxxxxxxxxxxx
```

- `SHOPIFY_STORE` = o subdomínio da loja (a parte antes de `.myshopify.com`)
- `SHOPIFY_TOKEN` = o token que começa com `shpat_`

**Salve o arquivo.**

> ⚠️ O arquivo `.env` é como uma senha. Não compartilhe, não envie por e-mail, não suba para GitHub.

### Passo 2 — Pronto. Pule para "Como usar".

Não precisa instalar dependências. O servidor usa apenas funções nativas do Node.js.

---

## ▶️ Como usar (todo dia)

### 1. Abrir o terminal na pasta

No VS Code:
- **File > Open Folder** e escolha a pasta `mooui-dashboard`
- Abra o terminal: **Terminal > New Terminal** (ou `Ctrl + '`)

### 2. Rodar o servidor

No terminal, digite:

```
node servidor.js
```

Você verá algo assim:

```
  ╔══════════════════════════════════════════════╗
  ║   MOOUI Dashboard · Ponte local rodando      ║
  ╠══════════════════════════════════════════════╣
  ║   🌐  http://localhost:3000                  ║
  ║   Loja:  mooui-br                            ║
  ║   Para parar: Ctrl+C                         ║
  ╚══════════════════════════════════════════════╝
```

### 3. Abrir o dashboard no navegador

Acesse: **http://localhost:3000**

O painel vai abrir e buscar os dados do Shopify ao vivo. Use o botão "Atualizar agora" sempre que quiser refazer a consulta.

### 4. Quando terminar

No terminal, aperte **Ctrl+C**. O servidor desliga e a porta fica livre.

---

## 🆘 Problemas comuns

### "Arquivo .env não encontrado"
Você ainda não criou o `.env`. Volte ao Passo 1 da configuração.

### "Faltam variáveis no .env"
Abra o `.env` e confirme que tem as duas linhas (`SHOPIFY_STORE` e `SHOPIFY_TOKEN`) e que estão preenchidas com os valores reais.

### Dashboard mostra "Não consegui buscar os dados"
1. Confira se o terminal está com o servidor rodando (mensagem da caixa colorida)
2. Confira se o token no `.env` está correto e não expirou
3. Veja a mensagem de erro detalhada que aparece em vermelho no dashboard

### "Address already in use" ao rodar o servidor
A porta 3000 já está ocupada (outro programa, ou um servidor anterior que ficou aberto). Feche os outros e tente de novo. Se persistir, abra o `servidor.js` e troque `const PORTA = 3000;` para `4000` ou outra.

### Erro 401 / 403 do Shopify
O token está errado, expirou, ou perdeu permissões. Volte ao admin do Shopify, confira o app customizado, e atualize o `.env`.

---

## 🔒 Segurança

- Toda comunicação com o Shopify acontece **do seu computador para o Shopify** — nada passa por servidores de terceiros.
- A chave fica no `.env`, que **nunca é enviada ao navegador** — o dashboard só vê os números, não a chave.
- Se você for compartilhar a pasta com alguém, **delete o `.env` primeiro**.

---

## 🆙 Quando quiser disponibilizar para a equipe

Quando decidir que vale a pena dar acesso para mais pessoas, você pode "subir" essa mesma ponte para a Cloudflare Workers ou Vercel (ambos gratuitos). O dashboard e a lógica continuam os mesmos — só muda onde o servidor mora.

Quando chegar essa hora, é só pedir ajuda — adapto em 5 minutos.

---

## 📝 Notas técnicas (opcional)

- O servidor consulta 3 datasets do ShopifyQL: vendas de hoje, vendas de ontem (para comparação), e sessões dos últimos 30 dias por landing page.
- Cada `/api/dados` faz 3 consultas em paralelo (1-2 segundos no total).
- A cota da API tem 20.000 pontos por minuto — você usaria menos de 1% mesmo com 100 atualizações por dia.
- O servidor não armazena nada — toda consulta é fresca, direto no Shopify.
