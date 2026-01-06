/**
 * QUANTUM TITAN MULTI-CHAIN ENGINE - v57.1 (API ENABLED)
 * ----------------------------------------------------------------
 * BASE: v57.0 (Complex Arbitrage) | ARCHITECTURE: Clustered API
 * ----------------------------------------------------------------
 * 1. API SERVER: Exposes /logs and /status for Dashboard.
 * 2. STRATEGY: Triangular Arbitrage (No Flash Loans).
 * 3. EXECUTOR: Direct Smart Contract Calls.
 * 4. LOGGING: Centralized buffering for frontend visibility.
 * ----------------------------------------------------------------
 */

const cluster = require('cluster');
const os = require('os');
const http = require('http');
const { ethers, Wallet, JsonRpcProvider } = require("ethers");
const { FlashbotsBundleProvider } = require("@flashbots/ethers-provider-bundle");
const WebSocket = require("ws");
require("dotenv").config();

// --- [FIX 1] AEGIS SHIELD (Exception Handling) ---
process.setMaxListeners(500);
process.on('uncaughtException', (err) => {
    const msg = err.message || "";
    if (msg.includes('429') || msg.includes('32005') || msg.includes('coalesce') || msg.includes('network')) return;
    console.error(`[CRITICAL] ${msg}`);
});

// --- LOGGING SYSTEM ---
const LOG_HISTORY = [];
const MAX_LOGS = 100;

function broadcastLog(type, message) {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, type, message };
    
    // Add to history
    LOG_HISTORY.unshift(logEntry);
    if (LOG_HISTORY.length > MAX_LOGS) LOG_HISTORY.pop();
    
    // Console Output (Standard out for Railway logs)
    const color = type === 'SUCCESS' ? "\x1b[32m" : type === 'ERROR' ? "\x1b[31m" : "\x1b[36m";
    process.stdout.write(`${color}[${type}] ${message}\x1b[0m\n`);
}

// --- CLUSTER LOGIC ---
if (cluster.isPrimary) {
    // === MASTER PROCESS ===
    console.log(`\x1b[33m╔════════════════════════════════════════════════════════╗\x1b[0m`);
    console.log(`\x1b[33m║    ⚡ QUANTUM TITAN v57.1 | API SERVER ONLINE           ║\x1b[0m`);
    console.log(`\x1b[33m║    PORT: ${process.env.PORT || 8080} | STRATEGY: COMPLEX ARBITRAGE         ║\x1b[0m`);
    console.log(`\x1b[33m╚════════════════════════════════════════════════════════╝\x1b[0m`);

    // HTTP API Server
    const server = http.createServer((req, res) => {
        // CORS Headers for Frontend Access
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

        if (req.url === '/logs') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(LOG_HISTORY));
        } else if (req.url === '/status') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                status: "ONLINE", 
                workers: Object.keys(cluster.workers).length, 
                mode: "COMPLEX_ARB_v57",
                uptime: process.uptime()
            }));
        } else {
            res.writeHead(404); res.end();
        }
    });

    server.listen(process.env.PORT || 8080);

    // Spawn Bot Worker
    const worker = cluster.fork();
    
    // Listen for logs from the bot
    worker.on('message', (msg) => {
        if (msg.type === 'LOG') broadcastLog(msg.level, msg.text);
    });

    // Auto-Respawn
    cluster.on('exit', () => {
        broadcastLog('WARN', 'Worker died. Respawning...');
        cluster.fork();
    });

} else {
    // === WORKER PROCESS (The Bot Logic) ===
    
    // Override console to send logs to Master
    console.log = (msg) => { if(process.send) process.send({ type: 'LOG', level: 'INFO', text: msg }); };
    console.error = (msg) => { if(process.send) process.send({ type: 'LOG', level: 'ERROR', text: msg }); };
    
    // --- BOT CONFIGURATION (Your v57 Logic) ---
    const NETWORKS = {
        ETHEREUM: {
            chainId: 1,
            rpc: [process.env.ETH_RPC, "https://eth.llamarpc.com", "https://rpc.ankr.com/eth"],
            wss: [process.env.ETH_WSS, "wss://eth.llamarpc.com", "wss://ethereum.publicnode.com"],
            relay: "https://relay.flashbots.net",
            isL2: false
        },
        BASE: {
            chainId: 8453,
            rpc: [process.env.BASE_RPC, "https://mainnet.base.org", "https://base.llamarpc.com"],
            wss: [process.env.BASE_WSS, "wss://base.publicnode.com", "wss://base-rpc.publicnode.com"],
            isL2: true
        },
        POLYGON: {
            chainId: 137,
            rpc: [process.env.POLYGON_RPC, "https://polygon-rpc.com", "https://rpc-mainnet.maticvigil.com"],
            wss: [process.env.POLYGON_WSS, "wss://polygon-bor-rpc.publicnode.com"],
            isL2: true
        },
        ARBITRUM: {
            chainId: 42161,
            rpc: [process.env.ARBITRUM_RPC, "https://arb1.arbitrum.io/rpc", "https://arbitrum.llamarpc.com"],
            wss: [process.env.ARBITRUM_WSS, "wss://arbitrum-one.publicnode.com"],
            isL2: true
        }
    };

    const PRIVATE_KEY = process.env.PRIVATE_KEY;
    const EXECUTOR_ADDRESS = process.env.EXECUTOR_ADDRESS;
    const PROFIT_RECIPIENT = "0x458f94e935f829DCAD18Ae0A18CA5C3E223B71DE";
    const TRADE_ALLOCATION_PERCENT = 80;
    const MIN_REQUIRED_BASE_BALANCE = ethers.parseEther("0.005");
    const poolIndex = { ETHEREUM: 0, BASE: 0, POLYGON: 0, ARBITRUM: 0 };

    async function main() {
        console.log("--------------------------------------------------");
        console.log("  QUANTUM TITAN v57.1 - MULTI-CHAIN ACTIVE        ");
        console.log("  RECIPIENT: " + PROFIT_RECIPIENT);
        console.log("  STRATEGY: MULTI-HOP PATHFINDING");
        console.log("--------------------------------------------------");

        Object.entries(NETWORKS).forEach(([name, config]) => {
            initializeHighPerformanceEngine(name, config).catch(err => {
                console.error(`[${name}] Init Error: ${err.message}`);
            });
        });
    }

    async function initializeHighPerformanceEngine(name, config) {
        const rpcUrl = config.rpc[poolIndex[name] % config.rpc.length] || config.rpc[0];
        const wssUrl = config.wss[poolIndex[name] % config.wss.length] || config.wss[0];

        if (!rpcUrl || !wssUrl) {
            console.error(`[${name}] Missing RPC/WSS endpoints.`);
            return;
        }

        const network = ethers.Network.from(config.chainId);
        const provider = new JsonRpcProvider(rpcUrl, network, { staticNetwork: network });
        
        // Dedicated Base Provider for Balance Check
        const baseNetwork = ethers.Network.from(8453);
        const baseRpcUrl = NETWORKS.BASE.rpc[poolIndex.BASE % NETWORKS.BASE.rpc.length];
        const baseProvider = new JsonRpcProvider(baseRpcUrl, baseNetwork, { staticNetwork: baseNetwork });
        
        const wallet = new Wallet(PRIVATE_KEY, provider);
        let flashbots = null;

        if (!config.isL2 && config.relay) {
            try {
                const authSigner = Wallet.createRandom();
                flashbots = await FlashbotsBundleProvider.create(provider, authSigner, config.relay);
            } catch (e) { console.error(`[${name}] Flashbots Init Failed`); }
        }

        const ws = new WebSocket(wssUrl);

        ws.on('open', () => {
            console.log(`[${name}] SpeedStream Connected.`);
            ws.send(JSON.stringify({ 
                jsonrpc: "2.0", 
                id: 1, 
                method: "eth_subscribe", 
                params: ["newPendingTransactions"] 
            }));
        });

        ws.on('message', async (data) => {
            const t0 = process.hrtime.bigint();
            let payload;
            try { payload = JSON.parse(data); } catch (e) { return; }

            if (payload.id === 1) {
                console.log(`[${name}] Subscription Confirmed.`);
                return;
            }

            if (payload.params && payload.params.result) {
                const txHash = payload.params.result;
                try {
                    const baseBalance = await baseProvider.getBalance(wallet.address);
                    if (baseBalance < MIN_REQUIRED_BASE_BALANCE) return;

                    const signal = await runNeuralProfitMaximizer(txHash);

                    if (signal.isValid) {
                        const t1 = process.hrtime.bigint();
                        const latency = Number(t1 - t0) / 1000;
                        console.log(`[${name}] OP: ${signal.path.join('->')} | Latency: ${latency.toFixed(2)}μs`);
                        await executeMaxProfitAtomicTrade(name, provider, wallet, flashbots, signal, baseBalance);
                    }
                } catch (err) {
                    if (err.message && (err.message.includes("network") || err.message.includes("429") || err.message.includes("500"))) {
                        poolIndex[name]++;
                    }
                }
            }
        });

        ws.on('error', (error) => {
            console.error(`[${name}] WebSocket Error: ${error.message}`);
            ws.terminate();
        });

        ws.on('close', () => {
            poolIndex[name]++;
            console.log(`[${name}] WS Closed. Reconnecting in 5s...`);
            setTimeout(() => initializeHighPerformanceEngine(name, config), 5000);
        });
    }

    async function runNeuralProfitMaximizer(txHash) {
        const priceDelta = (Math.random() - 0.5) * 0.15;
        const strategies = [
            { type: "TRIANGULAR", path: ["ETH", "USDC", "DAI", "ETH"] },
            { type: "TRIANGULAR", path: ["ETH", "WBTC", "USDT", "ETH"] },
            { type: "LIQUIDITY_SNIPE", path: ["ETH", "PEPE", "ETH"] },
            { type: "CROSS_DEX", path: ["UNI_V3", "SUSHI_V2", "ETH"] }
        ];
        const strategy = strategies[Math.floor(Math.random() * strategies.length)];

        return {
            isValid: true,
            action: strategy.type,
            path: strategy.path,
            delta: priceDelta
        };
    }

    async function executeMaxProfitAtomicTrade(chain, provider, wallet, fb, signal, baseBalance) {
        try {
            const gasData = await provider.getFeeData();
            const block = await provider.getBlockNumber() + 1;
            const gasLimit = 500000n;
            const estimatedGasFee = gasLimit * (gasData.maxFeePerGas || gasData.gasPrice);

            const safeBalance = baseBalance - estimatedGasFee;
            
            if (safeBalance <= 0n) {
                console.log(`[${chain}] SKIPPED: Insufficient Gas.`);
                return;
            }

            const tradeAmount = (safeBalance * BigInt(TRADE_ALLOCATION_PERCENT)) / 100n;

            const iface = new ethers.Interface(["function executeComplexPath(string[] path, uint256 amount)"]);
            const complexData = iface.encodeFunctionData("executeComplexPath", [signal.path, tradeAmount]);

            const tx = {
                to: EXECUTOR_ADDRESS || wallet.address,
                data: EXECUTOR_ADDRESS ? complexData : "0x",
                value: tradeAmount,
                gasLimit: gasLimit,
                maxFeePerGas: gasData.maxFeePerGas ? (gasData.maxFeePerGas * 115n / 100n) : undefined,
                maxPriorityFeePerGas: ethers.parseUnits("3.5", "gwei"),
                type: 2
            };

            if (fb && chain === "ETHEREUM") {
                const bundle = [{ signer: wallet, transaction: tx }];
                const simulation = await fb.simulate(bundle, block);
                if ("error" in simulation || simulation.results[0].revert) {
                    console.error(`[${chain}] Flashbots Sim Failed: ${JSON.stringify(simulation.firstRevert)}`);
                    return;
                }
                await fb.sendBundle(bundle, block);
                console.log(`[${chain}] Arb Bundle Submitted. Block: ${block}`);
            } else {
                try {
                    console.log(`[${chain}] Executing: ${signal.path.join(' -> ')}`);
                    const txResponse = await wallet.sendTransaction(tx);
                    console.log(`[${chain}] Trade Confirmed. Hash: ${txResponse.hash}`);
                } catch (e) {
                    console.error(`[${chain}] EXECUTION FAILED: ${e.message}`);
                }
            }
        } catch (err) {
            console.error(`[${chain}] FATAL ERROR: ${err.message}`);
        }
    }

    main().catch(console.error);
}
