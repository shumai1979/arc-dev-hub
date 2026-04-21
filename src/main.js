// ═══════════════════════════════════════════════════════════════
// ARC HUB V8.2 — Main Module
// Migrated to @circle-fin/bridge-kit + @circle-fin/swap-kit + viem
// Browser flow via createViemAdapterFromProvider(window.ethereum)
// ═══════════════════════════════════════════════════════════════

import confetti from 'canvas-confetti';
import { BridgeKit } from '@circle-fin/bridge-kit';
import { SwapKit } from '@circle-fin/swap-kit';
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2';
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  formatUnits,
  parseUnits,
  erc20Abi
} from 'viem';

// ─── CIRCLE KIT KEY ───
// Loaded from .env (never committed). Copy .env.example to .env and paste your Kit Key.
// Get one at https://developers.circle.com/w3s/keys#kit-keys (format: KIT_KEY:<id>:<secret>)
const KIT_KEY = import.meta.env.VITE_KIT_KEY || '';

// ─── CORS WORKAROUND ───
// Circle's Stablecoin Kits API (api.circle.com) does not include "x-user-agent"
// in its CORS Access-Control-Allow-Headers, so browser preflights fail for the
// swap endpoints (quote/swap/status). In dev we route those calls through the
// Vite proxy (see vite.config.js → server.proxy['/circle-proxy']). This MUST run
// before SwapKit is instantiated. On a production (non-dev) build there is no
// same-origin proxy available, so swap will continue to fail unless you deploy
// your own backend proxy (Vercel function, Cloudflare worker, etc.).
(function installCircleProxyFetch() {
  if (typeof window === 'undefined' || !window.fetch) return;
  const isDev = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV;
  // In dev: Vite proxy at /circle-proxy. In prod: Cloudflare Worker from env.
  const prodProxy = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_CIRCLE_PROXY_URL) || '';
  const target = isDev ? '/circle-proxy' : prodProxy;
  if (!target) return; // No proxy configured in prod — swap will fail CORS; bridge still works.
  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    try {
      let url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.startsWith('https://api.circle.com/')) {
        const rewritten = url.replace('https://api.circle.com', target);
        if (typeof input === 'string') {
          return origFetch(rewritten, init);
        }
        // Request object — rebuild with new URL
        return origFetch(new Request(rewritten, input), init);
      }
    } catch (_) {}
    return origFetch(input, init);
  };
})();

// ─── STATE ───
let adapter, walletAddress;
let bridgeKit, swapKit;
let publicClient, walletClient;
let slippageBps = 300;
let bridgeSpeed = 'FAST';

// ─── ARC TESTNET CONFIG (Circle Arc Testnet — chainId 5042002) ───
const ARC_TESTNET_CHAIN_ID = 5042002;
const ARC_RPC_URL = 'https://rpc.testnet.arc.network';
const ARC_EXPLORER_URL = 'https://testnet.arcscan.app';
const USDC_ARC = '0x3600000000000000000000000000000000000000';
const EURC_ARC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';

const arcTestnet = {
  id: ARC_TESTNET_CHAIN_ID,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [ARC_RPC_URL] },
    public: { http: [ARC_RPC_URL] }
  },
  blockExplorers: {
    default: { name: 'Arcscan', url: ARC_EXPLORER_URL }
  },
  testnet: true
};

// ═══════════════════════════════════════════════════════════════
// LOGGING
// ═══════════════════════════════════════════════════════════════
function log(type, msg) {
  const el = document.getElementById('log');
  if (!el) { console.log(`[${type}]`, msg); return; }
  const line = document.createElement('div');
  line.className = type;
  const ts = new Date().toTimeString().slice(0, 8);
  line.innerHTML = `<span class="ts">${ts}</span><span>${msg}</span>`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function explorerTxLink(hash) {
  if (!hash || typeof hash !== 'string') return '';
  const short = hash.slice(0, 10) + '…';
  return `<a href="${ARC_EXPLORER_URL}/tx/${hash}" target="_blank" rel="noopener">${short}</a>`;
}

// ═══════════════════════════════════════════════════════════════
// STEP INDICATORS
// ═══════════════════════════════════════════════════════════════
function stepSet(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'step ' + state;
}

function stepsShow(containerId) {
  document.getElementById(containerId).classList.add('visible');
}

function stepsReset(ids) {
  ids.forEach(id => stepSet(id, ''));
}

// ═══════════════════════════════════════════════════════════════
// BALANCES (via viem publicClient)
// ═══════════════════════════════════════════════════════════════
async function getBalance(tokenAddr) {
  if (!publicClient || !walletAddress) return '—';
  try {
    if (!tokenAddr) {
      const b = await publicClient.getBalance({ address: walletAddress });
      return parseFloat(formatUnits(b, 18)).toFixed(4);
    }
    const [bal, dec] = await Promise.all([
      publicClient.readContract({
        address: tokenAddr,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [walletAddress]
      }),
      publicClient.readContract({
        address: tokenAddr,
        abi: erc20Abi,
        functionName: 'decimals'
      })
    ]);
    return parseFloat(formatUnits(bal, dec)).toFixed(4);
  } catch (e) {
    console.warn('Balance read failed:', e?.message || e);
    return '—';
  }
}

async function syncBalances() {
  const tokenIn = document.getElementById('tokenIn').value;
  const tokenOut = document.getElementById('tokenOut').value;
  const addrIn = tokenIn === 'USDC' ? USDC_ARC : EURC_ARC;
  const addrOut = tokenOut === 'USDC' ? USDC_ARC : EURC_ARC;

  const [bIn, bOut, bUsdc] = await Promise.all([
    getBalance(addrIn),
    getBalance(addrOut),
    getBalance(USDC_ARC)
  ]);

  document.getElementById('balIn').textContent = bIn;
  document.getElementById('balOut').textContent = bOut;
  document.getElementById('balBridge').textContent = bUsdc;
  document.getElementById('balSend').textContent = bUsdc;
}

// ═══════════════════════════════════════════════════════════════
// CONNECT WALLET
// ═══════════════════════════════════════════════════════════════
async function ensureArcTestnet() {
  const hexId = '0x' + ARC_TESTNET_CHAIN_ID.toString(16);

  try {
    const current = await window.ethereum.request({ method: 'eth_chainId' });
    if (typeof current === 'string' && current.toLowerCase() === hexId.toLowerCase()) {
      return;
    }
  } catch (_) {
    // ignore — fall through to switch/add
  }

  const addParams = {
    chainId: hexId,
    chainName: 'Arc Testnet',
    nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
    rpcUrls: [ARC_RPC_URL],
    blockExplorerUrls: [ARC_EXPLORER_URL]
  };

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexId }]
    });
    return;
  } catch (err) {
    if (err && err.code === 4001) {
      throw new Error('User rejected the network switch');
    }
    log('inf', 'Arc Testnet not found — adding to wallet…');
    try {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [addParams]
      });
    } catch (addErr) {
      if (addErr && addErr.code === 4001) {
        throw new Error('User rejected adding Arc Testnet');
      }
      throw addErr;
    }
  }
}

async function connectWallet() {
  try {
    if (!window.ethereum) {
      log('err', 'No wallet detected — install MetaMask or Rabby');
      return;
    }

    log('inf', 'Requesting wallet connection…');
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    walletAddress = accounts[0];

    log('inf', 'Ensuring Arc Testnet is active…');
    await ensureArcTestnet();

    publicClient = createPublicClient({
      chain: arcTestnet,
      transport: http(ARC_RPC_URL)
    });
    walletClient = createWalletClient({
      chain: arcTestnet,
      transport: custom(window.ethereum),
      account: walletAddress
    });

    const btn = document.getElementById('connectBtn');
    btn.textContent = walletAddress.slice(0, 6) + '…' + walletAddress.slice(-4);
    btn.classList.add('connected');

    const info = document.getElementById('walletInfo');
    info.innerHTML = 'Connected<span class="chain">Arc Testnet</span>';
    info.classList.add('visible');

    document.getElementById('colophon-wallet').innerHTML =
      `Wallet <em>${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}</em>`;

    ['swapBtn', 'bridgeBtn', 'sendBtn'].forEach(id => {
      document.getElementById(id).disabled = false;
    });

    try {
      adapter = await createViemAdapterFromProvider({
        provider: window.ethereum,
        capabilities: { addressContext: 'user-controlled' }
      });

      bridgeKit = new BridgeKit();
      swapKit = new SwapKit();

      bridgeKit.on('approve', (evt) => {
        stepSet('b-approve', 'done');
        const hash = evt?.values?.txHash;
        log('ok', `Bridge › allowance granted${hash ? ' — ' + explorerTxLink(hash) : ''}`);
      });
      bridgeKit.on('burn', (evt) => {
        stepSet('b-burn', 'done');
        const hash = evt?.values?.txHash;
        log('ok', `Bridge › burn confirmed on Arc${hash ? ' — ' + explorerTxLink(hash) : ''}`);
      });
      bridgeKit.on('fetchAttestation', () => {
        stepSet('b-attest', 'done');
        log('inf', 'Bridge › attestation received from Circle');
      });
      bridgeKit.on('mint', (evt) => {
        stepSet('b-mint', 'done');
        const hash = evt?.values?.txHash;
        log('ok', `Bridge › minted on destination ✓${hash ? ' — ' + hash.slice(0, 10) + '…' : ''}`);
        confetti({ particleCount: 80, spread: 70 });
      });

      log('ok', 'Bridge Kit + Swap Kit initialised with viem adapter');
    } catch (e) {
      log('wrn', 'Kit init failed: ' + (e?.message || e));
      console.error(e);
    }

    await syncBalances();
    log('ok', `Wallet ${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)} connected`);

    // Wallet events — do NOT reload on chainChanged (that kills in-flight bridges).
    window.ethereum.on('accountsChanged', () => window.location.reload());
    window.ethereum.on('chainChanged', (cid) => {
      log('inf', `Wallet chain changed → ${cid}`);
    });
  } catch (e) {
    log('err', 'Connection failed: ' + (e?.message || e));
    console.error(e);
  }
}

// ═══════════════════════════════════════════════════════════════
// KIT KEY GUARD
// ═══════════════════════════════════════════════════════════════
function kitKeyReady() {
  // Real Circle Kit Key format is: KIT_KEY:<id>:<secret>
  if (typeof KIT_KEY !== 'string') return false;
  if (!KIT_KEY.startsWith('KIT_KEY:')) return false;
  if (KIT_KEY.includes('REPLACE_ME')) return false;
  const parts = KIT_KEY.split(':');
  // Expect at least 3 segments: ["KIT_KEY", "<id>", "<secret>"]
  return parts.length >= 3 && parts[1].length > 0 && parts[2].length > 0;
}

function warnKitKey() {
  log('err', 'Missing Circle Kit Key. Set KIT_KEY in src/main.js. Get a free key at developers.circle.com/w3s/keys#kit-keys');
}

// ═══════════════════════════════════════════════════════════════
// SWAP
// ═══════════════════════════════════════════════════════════════
async function estimateSwap() {
  const amt = document.getElementById('swapAmt').value;
  const outEl = document.getElementById('swapOut');
  const rateEl = document.getElementById('swapRate');

  if (!amt || parseFloat(amt) <= 0) {
    outEl.value = '';
    rateEl.textContent = 'awaiting quote';
    rateEl.classList.remove('live');
    return;
  }

  if (!swapKit || !adapter || !kitKeyReady()) {
    outEl.value = parseFloat(amt).toFixed(6);
    rateEl.textContent = kitKeyReady()
      ? '≈ 1:1 (connect wallet for live quote)'
      : '≈ 1:1 (Kit Key missing — see README)';
    return;
  }

  try {
    const tokenIn = document.getElementById('tokenIn').value;
    const tokenOut = document.getElementById('tokenOut').value;
    const est = await swapKit.estimate({
      from: { adapter, chain: 'Arc_Testnet' },
      tokenIn,
      tokenOut,
      amountIn: amt,
      config: { slippageBps, allowanceStrategy: 'permit', kitKey: KIT_KEY }
    });
    const outAmt = est?.estimatedOutput?.amount ?? '';
    outEl.value = outAmt;
    const rate = outAmt ? (parseFloat(outAmt) / parseFloat(amt)).toFixed(6) : '';
    rateEl.textContent = rate ? `1 ${tokenIn} ≈ ${rate} ${tokenOut}` : 'quote unavailable';
    rateEl.classList.add('live');
  } catch (e) {
    outEl.value = '';
    rateEl.textContent = 'quote unavailable';
    rateEl.classList.remove('live');
    console.warn('Swap estimate failed:', e?.message || e);
  }
}

async function doSwap() {
  const amt = document.getElementById('swapAmt').value;
  if (!amt || parseFloat(amt) <= 0) { log('err', 'Enter an amount to swap'); return; }
  if (!walletAddress) { log('err', 'Connect wallet first'); return; }
  // In prod, swap requires a CORS proxy (Cloudflare Worker) configured via VITE_CIRCLE_PROXY_URL.
  const isDev = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV;
  const hasProxy = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_CIRCLE_PROXY_URL;
  if (!isDev && !hasProxy) {
    log('err', 'Swap needs a Circle API proxy in production. See cloudflare-worker/README.md to deploy the free Cloudflare Worker and set VITE_CIRCLE_PROXY_URL as a repo secret.');
    return;
  }
  if (!swapKit || !adapter) { log('err', 'Swap Kit not initialised'); return; }
  if (!kitKeyReady()) { warnKitKey(); return; }

  const tokenIn = document.getElementById('tokenIn').value;
  const tokenOut = document.getElementById('tokenOut').value;

  stepsShow('swapSteps');
  stepsReset(['s-approve', 's-swap']);
  stepSet('s-approve', 'active');
  document.getElementById('swapBtn').disabled = true;
  log('inf', `Swap › initiating ${amt} ${tokenIn} → ${tokenOut}`);

  try {
    const result = await swapKit.swap({
      from: { adapter, chain: 'Arc_Testnet' },
      tokenIn,
      tokenOut,
      amountIn: amt,
      config: { slippageBps, allowanceStrategy: 'permit', kitKey: KIT_KEY }
    });

    stepSet('s-approve', 'done');
    stepSet('s-swap', 'done');
    const hash = result?.txHash || result?.steps?.find?.(s => s.txHash)?.txHash;
    log('ok', `Swap › settled${hash ? ' · ' + explorerTxLink(hash) : ''}`);
    if (result?.amountOut) log('ok', `Swap › received ${result.amountOut} ${tokenOut}`);
    confetti({ particleCount: 80, spread: 70 });
    await syncBalances();
  } catch (e) {
    stepSet('s-approve', 'error');
    stepSet('s-swap', 'error');
    log('err', 'Swap › ' + (e?.message || e));
    console.error(e);
  }

  document.getElementById('swapBtn').disabled = false;
}

// ═══════════════════════════════════════════════════════════════
// BRIDGE — CCTPv2 via bridge-kit
// ═══════════════════════════════════════════════════════════════
async function doBridge() {
  const amt = document.getElementById('bridgeAmt').value;
  const dest = document.getElementById('bridgeDest').value;

  if (!amt || parseFloat(amt) <= 0) { log('err', 'Enter an amount to bridge'); return; }
  if (!walletAddress) { log('err', 'Connect wallet first'); return; }
  if (!bridgeKit || !adapter) { log('err', 'Bridge Kit not initialised'); return; }

  const speed = (bridgeSpeed || 'FAST').toUpperCase();

  stepsShow('bridgeSteps');
  stepsReset(['b-approve', 'b-burn', 'b-attest', 'b-mint']);
  stepSet('b-approve', 'active');
  document.getElementById('bridgeBtn').disabled = true;
  log('inf', `Bridge › ${amt} USDC · Arc_Testnet → ${dest} · ${speed}`);
  log('inf', 'Bridge › wallet may prompt to switch networks during mint — this is expected.');

  try {
    const result = await bridgeKit.bridge({
      from: { adapter, chain: 'Arc_Testnet' },
      to: { adapter, chain: dest },
      amount: amt,
      token: 'USDC',
      config: { transferSpeed: speed }
    });

    log('ok', `Bridge › complete${result?.state ? ' · state: ' + result.state : ''}`);
    if (Array.isArray(result?.steps)) {
      result.steps.forEach(s => {
        if (s.txHash) log('inf', `  ${s.name}: ${s.txHash.slice(0, 10)}…`);
      });
    }
    log('inf', `Bridge › ${amt} USDC is now on ${dest}. Arc balance will show 0 (funds are on destination).`);
    try {
      await ensureArcTestnet();
      log('inf', 'Bridge › wallet switched back to Arc Testnet');
    } catch (_) { /* user declined switch */ }
    await syncBalances();
  } catch (e) {
    log('err', 'Bridge › ' + (e?.message || e));
    console.error(e);
  }

  document.getElementById('bridgeBtn').disabled = false;
}

// ═══════════════════════════════════════════════════════════════
// SEND — direct ERC20 transfer via viem walletClient
// ═══════════════════════════════════════════════════════════════
async function doSend() {
  const amt = document.getElementById('sendAmt').value;
  const to = document.getElementById('sendTo').value.trim();
  const token = document.getElementById('sendToken').value;

  if (!amt || parseFloat(amt) <= 0) { log('err', 'Enter an amount to send'); return; }
  if (!to || !to.startsWith('0x') || to.length !== 42) { log('err', 'Enter a valid 0x… recipient address'); return; }
  if (to.toLowerCase() === walletAddress?.toLowerCase()) {
    log('wrn', 'Sending to your own address — balance will not change.');
  }
  if (!walletAddress) { log('err', 'Connect wallet first'); return; }
  if (!walletClient || !publicClient) { log('err', 'Wallet client not ready'); return; }

  const tokenAddr = token === 'USDC' ? USDC_ARC : EURC_ARC;

  stepsShow('sendSteps');
  stepsReset(['t-approve', 't-send']);
  stepSet('t-approve', 'active');
  document.getElementById('sendBtn').disabled = true;
  log('inf', `Send › ${amt} ${token} → ${to.slice(0, 10)}…`);

  try {
    const decimals = await publicClient.readContract({
      address: tokenAddr,
      abi: erc20Abi,
      functionName: 'decimals'
    });
    const value = parseUnits(amt, decimals);

    stepSet('t-approve', 'done');
    stepSet('t-send', 'active');

    const hash = await walletClient.writeContract({
      address: tokenAddr,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to, value],
      account: walletAddress,
      chain: arcTestnet
    });

    log('inf', `Send › broadcast ${explorerTxLink(hash)} · awaiting receipt`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === 'reverted') {
      stepSet('t-send', 'error');
      log('err', `Send › REVERTED on-chain ${explorerTxLink(hash)} — tokens did NOT move`);
      return;
    }
    stepSet('t-send', 'done');
    log('ok', `Send › confirmed ${explorerTxLink(hash)}`);
    confetti({ particleCount: 80, spread: 70 });
    await syncBalances();
  } catch (e) {
    stepSet('t-approve', 'error');
    stepSet('t-send', 'error');
    log('err', 'Send › ' + (e?.message || e));
    console.error(e);
  }

  document.getElementById('sendBtn').disabled = false;
}

// ═══════════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════════
function flipTokens() {
  const tIn = document.getElementById('tokenIn');
  const tOut = document.getElementById('tokenOut');
  const tmp = tIn.value;
  tIn.value = tOut.value;
  tOut.value = tmp;
  syncBalances();
  estimateSwap();
}

function fillSelf() {
  if (walletAddress) {
    document.getElementById('sendTo').value = walletAddress;
    log('inf', 'Recipient → self');
  }
}

function setSlippage(bps, btn) {
  slippageBps = bps;
  document.querySelectorAll('.slippage-chips .chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  estimateSwap();
}

function setSpeed(speed, btn) {
  bridgeSpeed = (speed || 'FAST').toUpperCase();
  document.querySelectorAll('.speed-chips .chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  log('inf', `Transfer speed → ${bridgeSpeed}`);
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('connectBtn').addEventListener('click', connectWallet);
  document.getElementById('swapBtn').addEventListener('click', doSwap);
  document.getElementById('bridgeBtn').addEventListener('click', doBridge);
  document.getElementById('sendBtn').addEventListener('click', doSend);
  document.getElementById('flipBtn').addEventListener('click', flipTokens);
  document.getElementById('fillSelfBtn').addEventListener('click', fillSelf);

  document.getElementById('swapAmt').addEventListener('input', estimateSwap);
  document.getElementById('tokenIn').addEventListener('change', () => { syncBalances(); estimateSwap(); });
  document.getElementById('tokenOut').addEventListener('change', () => { syncBalances(); estimateSwap(); });

  document.querySelectorAll('.slippage-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => setSlippage(parseInt(chip.dataset.slip), chip));
  });
  document.querySelectorAll('.speed-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => setSpeed(chip.dataset.speed, chip));
  });

  log('inf', 'Terminal ready · Connect wallet to begin');
  if (!kitKeyReady()) {
    log('wrn', 'No Kit Key configured — swaps will not work. See KIT_KEY in src/main.js.');
  }
});
