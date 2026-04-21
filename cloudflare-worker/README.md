# Cloudflare Worker — Circle API Proxy

Proxy edge para `api.circle.com` que resolve o problema de CORS do `swap-kit`
em browsers (o header `x-user-agent` que o SDK envia não passa o preflight de
`api.circle.com`).

Só o swap precisa disto. O bridge-kit usa `iris-api.circle.com`, que tem CORS
aberto e funciona diretamente do browser.

---

## Deploy (gratuito — 100k req/dia no free tier)

1. Criar conta em https://dash.cloudflare.com/sign-up (free).
2. Workers & Pages → **Create** → **Create Worker** → dar um nome
   (ex: `archub-circle-proxy`) → **Deploy**.
3. Clicar em **Edit code**, apagar o conteúdo default, **colar o código de
   `worker.js`** deste repo, clicar **Save and deploy**.
4. A Cloudflare dá-te um URL tipo:
   `https://archub-circle-proxy.SEU-SUBDOMINIO.workers.dev`
5. Testar no browser: abrir esse URL → deve retornar JSON da Circle (mesmo
   que seja um 404 ou "missing auth", significa que o proxy encaminhou).

---

## Ligar ao ArcHub

**Em desenvolvimento (local):** não precisas do worker — o Vite dev server
já faz proxy local.

**Em produção (GitHub Pages):**

1. No repo do GitHub: **Settings → Secrets and variables → Actions →
   New repository secret**.
2. Nome: `VITE_CIRCLE_PROXY_URL`
3. Valor: `https://archub-circle-proxy.SEU-SUBDOMINIO.workers.dev`
   (sem trailing slash)
4. Faz um push qualquer. O workflow vai fazer build com essa env e o
   site passa a usar o worker para o swap.

---

## Segurança

- O código do worker está aberto na Cloudflare — **não inclui o Kit Key**.
- O Kit Key continua a ser enviado pelo browser no header Authorization.
  Quem intercepta o request ao worker vê o key (mesmo cenário de qualquer
  chamada direta do browser).
- Para endurecer: em `worker.js`, trocar `ALLOW_ORIGIN = '*'` pela URL exata
  do site (`'https://shumai1979.github.io'`) para evitar que terceiros
  façam hotlink do teu proxy.
- Para segredos reais em produção, mover o Kit Key para dentro do worker
  como env var e injetar o header Authorization no worker — assim o browser
  nunca vê o key. Isto é uma melhoria para v2.