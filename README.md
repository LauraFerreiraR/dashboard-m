# Dashboard Shopify (versão local)

Dashboard que se conecta ao Shopify em tempo real e mostra vendas do dia, jornada do cliente, recompra e mais. Roda no seu computador (localhost), sem custo e sem hospedagem online.

---

## O que vem aqui

```
├── servidor.js       ← ponte: conversa com o Shopify
├── dashboard.html    ← painel visual
├── .env.example      ← modelo para criar seu .env
└── README.md         ← este arquivo
```

---

## Configurar (primeira vez)

### 1. Criar o arquivo `.env`

Na pasta do projeto, copie `.env.example` e renomeie para `.env`.

Preencha com os dados da sua loja:

```
SHOPIFY_STORE=sua-loja
SHOPIFY_TOKEN=shpat_xxxxxxxxxxxxxxxxxx
```

- `SHOPIFY_STORE` = o subdomínio da loja (antes de `.myshopify.com`)
- `SHOPIFY_TOKEN` = token do app customizado no admin do Shopify

### 2. Logo

Coloque o arquivo da logo com o nome `logo.png` na mesma pasta.

---

## Como usar

```bash
node servidor.js
```

Acesse **http://localhost:0000** no navegador.

---

## Segurança

- O `.env` nunca é enviado ao navegador — só o servidor lê.
- Não suba o `.env` para o GitHub (já está no `.gitignore`).
