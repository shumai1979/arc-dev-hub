# Deploy Guide — GitHub Pages (PT)

Passo a passo para publicar o ArcHub no GitHub Pages.

Repo: https://github.com/shumai1979/arc-dev-hub
URL final: https://shumai1979.github.io/arc-dev-hub/

---

## 1 — Testar localmente

```bash
npm install
cp .env.example .env
# edita .env e mete a tua Kit Key
npm run dev
```

Abre `http://localhost:5173`. Confirma que:
- **Connect Wallet** liga (MetaMask/Rabby)
- **Send** funciona (USDC/EURC)
- **Bridge** funciona (Arc → Base Sepolia)
- **Swap** funciona (USDC↔EURC) — usa o proxy de dev `/circle-proxy`

---

## 2 — Configurar o secret do Kit Key

Na página do repo no GitHub:

1. **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret**
3. Nome: `VITE_KIT_KEY`
4. Valor: `KIT_KEY:<id>:<secret>` (a tua Kit Key completa)
5. **Add secret**

Sem este passo o build em CI vai ficar com Kit Key vazia e a app mostra "Kit Key not configured".

---

## 3 — Activar GitHub Pages

1. **Settings** → **Pages**
2. **Build and deployment** → **Source:** `GitHub Actions`

Não escolher branch — usar "GitHub Actions" é o que o workflow em `.github/workflows/deploy.yml` precisa.

---

## 4 — Push inicial

```bash
git init -b main
git add .
git commit -m "Initial commit: ArcHub with bridge-kit + swap-kit + viem"
git remote add origin https://github.com/shumai1979/arc-dev-hub.git
git push -u origin main
```

O `.env` fica de fora (já está no `.gitignore`). O workflow vai buscar o `VITE_KIT_KEY` ao secret do passo 2.

---

## 5 — Aguardar o deploy

- Separador **Actions** → vê o workflow "Deploy to GitHub Pages"
- Primeira corrida: ~2-3 min
- Quando aparecer ✅, o site está live em https://shumai1979.github.io/arc-dev-hub/

---

## Actualizações futuras

```bash
git add .
git commit -m "mensagem"
git push
```

Cada push a `main` re-faz build + deploy automaticamente.

---

## Nota sobre Swap em produção

A API da Circle (`api.circle.com/v1/stablecoinKits/*`) bloqueia CORS porque
o SDK envia o header `x-user-agent`. Em dev, o `vite.config.js` tem um proxy
a `/circle-proxy` que resolve. Em GitHub Pages **não há backend same-origin**,
por isso o Swap vai falhar em produção.

Opções para resolver:
- Vercel serverless function
- Cloudflare Worker
- Mini-backend Express em Render/Fly/Railway

Bridge e Send funcionam normalmente em produção — só o Swap precisa de proxy.

---

## Texto para partilhar no Discord da Arc

> **🏗️ Built on Arc: ArcHub — Circle Bridge + Swap + Send terminal**
>
> A stablecoin terminal for Arc Testnet using the official Circle SDKs
> (`@circle-fin/bridge-kit` + `@circle-fin/swap-kit`). Three instruments in one place:
> CCTP v2 bridge, USDC↔EURC swap, and direct ERC-20 send.
>
> Live: https://shumai1979.github.io/arc-dev-hub/
> Code: https://github.com/shumai1979/arc-dev-hub
>
> Feedback welcome 🙏

---

## Troubleshooting

**Build falha no Actions**
- Abre o log do workflow — o erro mais comum é falta do secret `VITE_KIT_KEY`.

**Site fica em branco**
- F12 → Console — verifica erros de path (ex: `/arc-dev-hub/` incorrecto).
- `REPO_NAME` em `vite.config.js` tem de corresponder exactamente ao nome do repo.

**Swap dá "Failed to fetch"**
- Esperado em produção — ver nota acima sobre CORS.

**"Kit Key not configured" em produção**
- Secret não está definido em `Settings → Secrets and variables → Actions`.

**Renomear o repo mais tarde**
1. GitHub → Settings → Repository name → renomeia
2. Actualiza `REPO_NAME` em `vite.config.js`
3. `git remote set-url origin https://github.com/shumai1979/novo-nome.git`
4. Commit + push
