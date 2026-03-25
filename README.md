# Sonic Arbitrage Bot

A production-ready arbitrage bot for [Sonic chain](https://soniclabs.com) (EVM chainId = 146) that detects and executes atomic arbitrage opportunities between **Shadow** (shadow.so) and **Beets / BeethovenX V3** (beets.fi) on the **USDC/WS** (and optionally USDC/WETH) pairs.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         React UI (port 3000)                │
│  Dashboard: P&L, opportunities, trades, wallet balance      │
│  Controls: auto-trade, slippage, emergency stop             │
└────────────────────────┬────────────────────────────────────┘
                         │ WebSocket (socket.io)
┌────────────────────────▼────────────────────────────────────┐
│                     Backend (port 3001)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │RpcManager│  │ArbFinder │  │RiskMgr   │  │Executor   │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬─────┘  │
│       │             │              │               │        │
│  ┌────▼─────┐  ┌────▼─────┐  ┌────▼─────┐  ┌─────▼─────┐  │
│  │Shadow    │  │Beets     │  │Simulator │  │NonceManager│  │
│  │Adapter   │  │Adapter   │  │(eth_call)│  │(Redis)     │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────┘  │
└────────────────────────────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   PostgreSQL          Redis          Sonic RPC
   (trade history)  (nonce locks)  (chain calls)
```

**Key components:**

| Module | Description |
|---|---|
| `RpcManager` | Multi-RPC round-robin with exponential backoff |
| `ShadowAdapter` | UniV2-style pool adapter for Shadow DEX |
| `BeetsAdapter` | Balancer V3 Vault adapter for BeethovenX |
| `ArbFinder` | Cross-DEX price comparison and profit calculation |
| `RiskManager` | Slippage, exposure, daily-loss, circuit-breaker checks |
| `Simulator` | Pre-broadcast `eth_call` simulation |
| `Executor` | Signs and broadcasts (atomic or sequential) |
| `NonceManager` | Distributed nonce management via Redis |
| `WsServer` | Real-time socket.io server for the UI |

---

## Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- A Sonic RPC endpoint (default: `https://rpc.soniclabs.com`)

### 1. Clone & configure

```bash
git clone <repo>
cd sonicarbitragev1
cp .env.example .env
# Edit .env — fill in token addresses, pool addresses, and PRIVATE_KEY (dev only)
```

> **⚠️ Before running live:** Replace all `0xTODO` placeholders in `.env` with real
> Sonic mainnet addresses. See the [Token Addresses](#token-addresses) section.

### 2. Start all services (Docker)

```bash
cd infra
docker-compose up -d
```

This starts: Postgres, Redis, Backend, UI, Prometheus, Grafana.

- UI: http://localhost:3000
- Backend: http://localhost:3001
- Prometheus: http://localhost:9091
- Grafana: http://localhost:3003 (admin / admin)

### 3. Run backend in development

```bash
cd backend
npm install
npm run dev
```

### 4. Run UI in development

```bash
cd ui
npm install
npm start
```

---

## Token Addresses

**You must set real Sonic mainnet addresses in your `.env` before running live.**

To find addresses:
1. Check [Sonicscan](https://sonicscan.org) — search for "USDC", "Wrapped Sonic"
2. Check [Shadow docs / app](https://shadow.so) for pool addresses
3. Check [Beets API](https://api.beets.fi/graphql) for pool IDs:
   ```bash
   curl -X POST https://api.beets.fi/graphql \
     -H 'Content-Type: application/json' \
     -d '{"query":"{ poolGetPools(where:{chainIn:[SONIC]}) { id address name } }"}'
   ```

---

## Dry-Run Mode

The bot starts in `DRY_RUN=true` by default — it runs the full pipeline (scanning, simulating, risk checks) but **never broadcasts transactions**.

**Recommended:** Run in dry-run for at least 2 weeks on mainnet fork before enabling live trading.

To enable live trading:
1. Set `DRY_RUN=false` in `.env`
2. Enable `autoTrade` via the UI Controls panel

---

## CLI Tools

```bash
# Simulate a single scan and print opportunity breakdown
cd backend
npm run simulate

# Replay last 10 trades from database
npm run replay -- --limit=10
```

---

## Testing

### Backend unit tests

```bash
cd backend
npm test              # Run all unit tests
npm run test:coverage # With coverage report
```

### Hardhat contract tests

```bash
cd hardhat
npm install
npx hardhat compile
npx hardhat test

# Fork tests (requires live RPC)
FORK_SONIC=true npx hardhat test
```

---

## Smart Contract (AtomicArb)

An optional `AtomicArb.sol` helper is provided in `hardhat/contracts/`. It executes two swaps in a single transaction and reverts if profit is insufficient.

```bash
# Deploy to local fork
cd hardhat
npx hardhat node --fork https://rpc.soniclabs.com &
npx hardhat run scripts/deploy.ts --network localhost
# Copy the address to .env: ATOMIC_HELPER_ADDRESS=0x...
```

---

## Monitoring

- **Prometheus metrics** at `http://localhost:3001/metrics`
- **Grafana** at `http://localhost:3003` — import the [community Prometheus dashboard](https://grafana.com/grafana/dashboards/11074) or create panels for:
  - `arb_opportunities_total`
  - `arb_executed_total`
  - `arb_failed_total`
  - `last_profit_usd`
  - `wallet_balance_usd`

---

## Security Checklist

- [ ] **Never store private keys in source code.** Use `.env` (dev only) or AWS KMS / GCP KMS / HSM in production.
- [ ] **Use a multisig wallet** for production funds (e.g., Gnosis Safe).
- [ ] **Run in DRY_RUN mode** for at least 2 weeks before going live.
- [ ] **Keep circuit breaker configured** — accessible from the UI emergency stop button.
- [ ] **Rotate RPC endpoints** — use multiple providers, don't expose API keys.
- [ ] **Set `maxDailyLossUsd`** — the bot will halt automatically if losses exceed the limit.
- [ ] **Review all `0xTODO` addresses** before deployment — never trade with wrong pool addresses.
- [ ] **Simulate before broadcasting** — the bot always runs `eth_call` before any tx; do not disable this.
- [ ] **Monitor Telegram/email alerts** — configure alerting for circuit breaker trips and repeated failures.
- [ ] **Never run with `autoTrade=true` immediately** — enable it manually via the UI after observing dry-run behavior.

---

## Project Structure

```
sonicarbitragev1/
├── .env.example              # Environment variable template
├── .gitignore
├── README.md                 # This file
│
├── backend/                  # Node.js + TypeScript backend
│   ├── src/
│   │   ├── index.ts          # Entry point
│   │   ├── config.ts         # Env config
│   │   ├── logger.ts         # Pino JSON logger
│   │   ├── rpcManager.ts     # Multi-RPC with fallback
│   │   ├── arbFinder.ts      # Cross-DEX arb detection
│   │   ├── riskManager.ts    # Risk checks & circuit breaker
│   │   ├── executor.ts       # Tx builder & broadcaster
│   │   ├── simulator.ts      # eth_call simulation
│   │   ├── nonceManager.ts   # Distributed nonce management
│   │   ├── metrics.ts        # Prometheus metrics
│   │   ├── wsServer.ts       # WebSocket server
│   │   ├── types.ts          # Shared TypeScript types
│   │   ├── poolAdapters/
│   │   │   ├── ShadowAdapter.ts
│   │   │   └── BeetsAdapter.ts
│   │   ├── db/
│   │   │   ├── index.ts      # PostgreSQL queries
│   │   │   └── migrations/
│   │   │       └── 001_init.sql
│   │   └── cli/
│   │       ├── simulate.ts   # CLI simulation tool
│   │       └── replay.ts     # CLI replay tool
│   ├── test/                 # Unit tests
│   ├── Dockerfile
│   └── package.json
│
├── ui/                       # React + TypeScript dashboard
│   ├── src/
│   │   ├── index.tsx
│   │   ├── pages/Dashboard.tsx
│   │   ├── components/       # StatusBar, ControlPanel, etc.
│   │   ├── hooks/useWebSocket.ts
│   │   └── lib/types.ts
│   ├── Dockerfile
│   └── package.json
│
├── hardhat/                  # Smart contracts & fork tests
│   ├── contracts/AtomicArb.sol
│   ├── scripts/deploy.ts
│   ├── test/AtomicArb.test.ts
│   └── hardhat.config.ts
│
├── infra/
│   ├── docker-compose.yml
│   ├── prometheus.yml
│   └── k8s/manifests.yaml
│
└── .github/
    └── workflows/ci.yml
```

---

## Extending: Adding a New DEX Adapter

1. Create `backend/src/poolAdapters/MyDexAdapter.ts` implementing `PoolAdapter`.
2. Register the adapter in `backend/src/arbFinder.ts` `ArbFinder` constructor.
3. Add pool addresses to `.env.example` and `config.ts`.
4. Write unit tests in `backend/test/myDexAdapter.test.ts`.

---

## License

MIT
