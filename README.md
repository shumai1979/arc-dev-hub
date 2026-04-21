# ARC HUB — Circle App Kit Terminal

A premium stablecoin terminal for the **Circle Arc Testnet**, built with the official
Circle SDKs (`@circle-fin/bridge-kit` + `@circle-fin/swap-kit` + `@circle-fin/adapter-viem-v2`).
Three instruments: **Bridge**, **Swap**, and **Send** — all wired to browser wallets (MetaMask, Rabby).

**Live demo:** https://shumai1979.github.io/arc-dev-hub/

![Arc](https://img.shields.io/badge/Arc-Testnet-6b8e7f)
![Circle](https://img.shields.io/badge/Circle-Bridge%20%2B%20Swap%20Kit-2d4a6b)
![Vite](https://img.shields.io/badge/Vite-5-ffc45c)
![Deploy](https://github.com/shumai1979/arc-dev-hub/actions/workflows/deploy.yml/badge.svg)

---

## Features

- **Bridge** — CCTP v2 cross-chain USDC transfers (Arc → Base / Ethereum / Arbitrum / Polygon Sepolia)
- **Swap** — Same-chain USDC ↔ EURC with configurable slippage (requires backend proxy in prod — see below)
- **Send** — Native ERC-20 transfers via viem `walletClient`
- Live USDC / EURC balance sync on Arc Testnet
- Step-by-step transaction tracking (approve → burn → attestation → mint)
- Explorer deep-links on every success
- Auto chain-switch + add Arc Testnet to wallet if missing

---

## Quick Start (local)

```bash
# 1. Clone
git clone https://github.com/shumai1979/arc-dev-hub.git
cd arc-dev-hub

# 2. Install
npm install

# 3. Set up your Kit Key
cp .env.example .env
# then edit .env and paste your real Kit Key from https://developers.circle.com/w3s/keys#kit-keys

# 4. Run dev server
npm run dev
# opens http://localhost:5173
```

Dev server includes a reverse-proxy (`/circle-proxy` → `https://api.circle.com`) so **Swap works end-to-end locally**.

---

## Arc Testnet config

| Field | Value |
|---|---|
| Chain ID | `5042002` |
| RPC URL | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| Faucet | `https://faucet.circle.com` |
| USDC | `0x3600000000000000000000000000000000000000` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |

The app will prompt to add Arc Testnet on first connect if it's not already in your wallet.

---

## Deploy — GitHub Pages

This repo auto-deploys to GitHub Pages on every push to `main` via
`.github/workflows/deploy.yml`.

### One-time setup

1. Add your Kit Key as a repo secret:
   **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `VITE_KIT_KEY`
   - Value: `KIT_KEY:<id>:<secret>`

2. Enable GitHub Pages:
   **Settings → Pages → Build and deployment → Source: GitHub Actions**

3. Push to `main`. The workflow builds and deploys to
   `https://<user>.github.io/arc-dev-hub/`.

---

## Production note: Swap + CORS

Circle's Stablecoin Kits API (`api.circle.com/v1/stablecoinKits/*`) does **not**
include `x-user-agent` in its CORS `Access-Control-Allow-Headers`, so browsers
reject the preflight request for swap quotes and executions.

**What works out of the box:**
- `Bridge` ✅ (uses CCTP attestation via `iris-api.circle.com`, which is CORS-enabled)
- `Send` ✅ (pure on-chain viem `writeContract` call)

**Swap in production:**
The deployed GitHub Pages build has no same-origin backend, so the in-app
dev-time workaround (Vite proxy) does not apply. To enable swap on the public
demo you'd need a small backend proxy. A few options:

- A Vercel / Cloudflare / Netlify edge function that forwards
  `/api/circle/*` → `https://api.circle.com/v1/*`, and ideally holds the Kit
  Key server-side (so it never ships to the browser).
- A Render / Fly / Railway Express mini-service doing the same.

Until that exists, swap will fail on the public URL with
`Failed to fetch (CORS)`. Bridge and Send keep working.

---

## Project structure

```
arc-dev-hub/
├── .env.example          # Template — copy to .env and fill in VITE_KIT_KEY
├── .github/workflows/
│   └── deploy.yml        # GitHub Actions → GitHub Pages
├── index.html            # Entry
├── src/
│   ├── main.js           # SDK integration: Bridge / Swap / Send
│   └── styles.css        # Editorial theme
├── vite.config.js        # Dev proxy + GH-Pages base path
└── package.json
```

---

## How the Circle SDKs are wired

### Bridge (CCTP v2)
```js
import { BridgeKit } from '@circle-fin/bridge-kit';
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2';

const adapter = await createViemAdapterFromProvider({
  provider: window.ethereum,
  capabilities: { addressContext: 'user-controlled' }
});
const bridgeKit = new BridgeKit({ kitKey: KIT_KEY });
bridgeKit.on('approve', ...); bridgeKit.on('burn', ...);
bridgeKit.on('fetchAttestation', ...); bridgeKit.on('mint', ...);

await bridgeKit.bridge({
  from: { adapter, chain: 'Arc_Testnet' },
  to:   { adapter, chain: 'Base_Sepolia' },
  amount: '1.0', token: 'USDC',
  config: { transferSpeed: 'FAST' }
});
```

### Swap
```js
import { SwapKit } from '@circle-fin/swap-kit';

const swapKit = new SwapKit();
await swapKit.swap({
  from: { adapter, chain: 'Arc_Testnet' },
  tokenIn: 'USDC', tokenOut: 'EURC',
  amountIn: '10.0',
  config: { kitKey: KIT_KEY, slippageBps: 300, allowanceStrategy: 'permit' }
});
```

### Send (direct viem)
```js
import { createWalletClient, custom, erc20Abi, parseUnits } from 'viem';

const walletClient = createWalletClient({ chain: arcTestnet, transport: custom(window.ethereum) });
await walletClient.writeContract({
  address: USDC_ARC, abi: erc20Abi, functionName: 'transfer',
  args: [recipient, parseUnits('1.0', 6)]
});
```

---

## Troubleshooting

**"Kit Key not configured"**
Make sure `.env` exists locally with a valid `VITE_KIT_KEY`, or the secret is set in GitHub Actions.

**Wallet stuck on wrong chain after bridge**
The bridge switches wallet chains during the mint step — that's expected. The
app no longer auto-reloads on `chainChanged` (that was killing mid-bridge flows).

**`Address should not be provided for user-controlled adapters`**
Don't pass `address:` to `from`/`to` of `bridgeKit.bridge()` — the user-controlled
viem adapter auto-resolves the wallet address.

**`SERVICE_UNKNOWN_ERROR: Failed to fetch` on swap (prod only)**
CORS — see the production note above. Swap needs a backend proxy to ship publicly.

---

## Resources

- [Arc Docs](https://docs.arc.network)
- [Bridge Kit Quickstart](https://docs.arc.network/app-kit/quickstarts/bridge-between-evm-chains)
- [Swap Kit Docs](https://docs.arc.network/app-kit/swap)
- [Kit Keys](https://developers.circle.com/w3s/keys#kit-keys)
- [Arc Testnet Explorer](https://testnet.arcscan.app)

---

Built on Arc Testnet.
