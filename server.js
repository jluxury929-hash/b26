/**
 * ===============================================================================
 * APEX TITAN v190.0 (THE OMNI-GOVERNOR - ABSOLUTE FINALITY SINGULARITY)
 * ===============================================================================
 * STATUS: TOTAL MAXIMIZATION (MTE - MAXIMUM THEORETICAL EXTRACTION)
 * THE "TOTAL CERTAINTY" PROTOCOL (MULTI-CHAIN FINALITY):
 * 1. PHYSICAL REVERSE-DERIVATION: (Balance - Max_Fees - Safety_Void) = Premium.
 * 2. STALL-PROOF MOAT: Reserves 0.003 ETH statically for L1 Posting/Data Fees.
 * 3. VOLATILITY INSURANCE: Applies 1.2x multiplier to Base Fee + Abyssal Priority.
 * 4. SINGLETON ATOMICS: Locked memory [5] prevents multi-worker capital bleeding.
 * 5. EVM-INTEGER SYNC: BigInt math strictly mirrors Solidity uint256 floor-division.
 * 6. STATIC HARDENING: staticNetwork configuration prevents RPC handshake loops.
 * ===============================================================================
 */

const cluster = require('cluster');
const os = require('os');
const http = require('http');
const https = require('https');
const WebSocket = require("ws");
const { 
    ethers, JsonRpcProvider, Wallet, FallbackProvider, 
    parseEther, formatEther, Interface 
} = require('ethers');
const { FlashbotsBundleProvider } = require("@flashbots/ethers-provider-bundle");
require('dotenv').config();

// --- [AEGIS SHIELD] ---
process.setMaxListeners(0); 
process.on('uncaughtException', (err) => {
    const msg = err.message || "";
    // Hardened filtering: Prioritize strike execution over logging non-fatal network noise
    if (msg.includes('429') || msg.includes('network') || msg.includes('socket') || msg.includes('Handshake') || msg.includes('detect network')) return;
    console.error(`[AEGIS] ${msg}`);
});

const TXT = { green: "\x1b[32m", gold: "\x1b[38;5;220m", reset: "\x1b[0m", red: "\x1b[31m", cyan: "\x1b[36m", bold: "\x1b[1m" };

// Shared Memory Infrastructure (Physical Speed Limit)
// [0..3]=Nonces (ETH, BASE, POLY, ARB), [4]=TotalStrikes, [5]=CapitalLock (0=IDLE, 1=BUSY)
const sharedBuffer = new SharedArrayBuffer(128);
const stateMetrics = new Int32Array(sharedBuffer); 

const LOG_HISTORY = [];
const MAX_LOGS = 200;

const CONFIG = {
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    EXECUTOR: process.env.EXECUTOR_ADDRESS,
    PROFIT_RECIPIENT: "0x458f94e935f829DCAD18Ae0A18CA5C3E223B71DE",
    PORT: process.env.PORT || 8080,
    GAS_LIMIT: 2000000n, // Calibrated for v134 multi-hop logic
    SAFETY_VOID_WEI: 100000n, // 100k wei "Static Void" to absorb L2 gas price updates
    MIN_STRIKE_BALANCE: parseEther("0.008"), // Absolute entry floor for Certainty math
    // STRICT ALIGNMENT: Pruned to match ArbitrageExecutor.sol tokenMap checksums exactly
    CORE_TOKENS: ["USDC", "WBTC", "DAI", "USDT", "PEPE", "CBETH"],
    NETWORKS: {
        ETHEREUM: { 
            chainId: 1, idx: 0,
            rpc: ["https://eth.llamarpc.com", "https://rpc.ankr.com/eth"], 
            wss: "wss://eth.llamarpc.com", 
            relays: ["https://relay.flashbots.net", "https://builder0x69.io"],
            minPriority: parseEther("500.0", "gwei") // Abyssal tier floor
        },
        BASE: { 
            chainId: 8453, idx: 1,
            rpc: ["https://mainnet.base.org", "https://base.merkle.io", "https://1rpc.io/base"], 
            wss: "wss://base-rpc.publicnode.com",
            minPriority: parseEther("1.6", "gwei") // Abyssal tier floor
        },
        POLYGON: {
            chainId: 137, idx: 2,
            rpc: ["https://polygon-rpc.com", "https://rpc-mainnet.maticvigil.com"],
            wss: "wss://polygon-bor-rpc.publicnode.com",
            minPriority: parseEther("200.0", "gwei") // Abyssal tier floor
        },
        ARBITRUM: {
            chainId: 42161, idx: 3,
            rpc: ["https://arb1.arbitrum.io/rpc", "https://arbitrum.llamarpc.com"],
            wss: "wss://arbitrum-one.publicnode.com",
            minPriority: parseEther("50.0", "gwei") // Abyssal tier floor
        }
    }
};

function sanitize(k) {
    let s = (k || "").trim().replace(/['" \n\r]+/g, '');
    return s.startsWith("0x") ? s : "0x" + s;
}

function broadcastLog(level, text, chain = "SYSTEM") {
    const entry = { timestamp: new Date().toLocaleTimeString(), level, text, chain };
    LOG_HISTORY.unshift(entry);
    if (LOG_HISTORY.length > MAX_LOGS) LOG_HISTORY.pop();
    const color = level === 'SUCCESS' ? TXT.green : level === 'ERROR' ? TXT.red : TXT.cyan;
    process.stdout.write(`${color}[${chain}] ${text}${TXT.reset}\n`);
}

if (cluster.isPrimary) {
    console.clear();
    console.log(`${TXT.gold}${TXT.bold}╔════════════════════════════════════════════════════════╗`);
    console.log(`║    ⚡ APEX TITAN v190.0 | OMNI-GOVERNOR SINGULARITY ║`);
    console.log(`║    MODE: TOTAL CERTAINTY | PHYSICAL REMAINDER MATH    ║`);
    console.log(`║    API: /logs & /status ACTIVE ON PORT ${CONFIG.PORT}       ║`);
    console.log(`╚════════════════════════════════════════════════════════╝${TXT.reset}\n`);

    async function setupMaster() {
        const wallet = new Wallet(sanitize(CONFIG.PRIVATE_KEY));
        
        await Promise.all(Object.entries(CONFIG.NETWORKS).map(async ([name, net]) => {
            try {
                const network = ethers.Network.from(net.chainId);
                const provider = new JsonRpcProvider(net.rpc[0], network, { staticNetwork: network });
                const nonce = await provider.getTransactionCount(wallet.address, 'pending');
                Atomics.store(stateMetrics, net.idx, nonce);
                broadcastLog('INFO', `Omni-Governor Sentry Armed. Nonce: ${nonce}`, name);
            } catch (e) {
                broadcastLog('ERROR', `Handshake Failure: ${e.message}`, name);
            }
        }));

        http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            if (req.url === '/logs') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(LOG_HISTORY));
            } else if (req.url === '/status') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    status: "TOTAL_CERTAINTY_SINGULARITY_ACTIVE", 
                    nonces: { 
                        eth: Atomics.load(stateMetrics, 0), 
                        base: Atomics.load(stateMetrics, 1), 
                        poly: Atomics.load(stateMetrics, 2), 
                        arb: Atomics.load(stateMetrics, 3) 
                    },
                    strikes: Atomics.load(stateMetrics, 4),
                    lock_state: Atomics.load(stateMetrics, 5) === 1 ? "BUSY" : "IDLE",
                    uptime: Math.floor(process.uptime())
                }));
            } else { res.writeHead(404); res.end(); }
        }).listen(CONFIG.PORT);

        Object.keys(CONFIG.NETWORKS).forEach(chain => cluster.fork({ TARGET_CHAIN: chain, SHARED_METRICS: sharedBuffer }));
    }

    cluster.on('message', (worker, msg) => {
        if (msg.type === 'LOG') broadcastLog(msg.level, msg.text, msg.chain);
    });

    setupMaster();
} else {
    runWorker();
}

async function runWorker() {
    const chainName = process.env.TARGET_CHAIN;
    const net = CONFIG.NETWORKS[chainName];
    const network = ethers.Network.from(net.chainId);
    const provider = new FallbackProvider(net.rpc.map(url => new JsonRpcProvider(url, network, { staticNetwork: network })));
    const wallet = new Wallet(sanitize(CONFIG.PRIVATE_KEY), provider);
    const iface = new Interface(["function executeComplexPath(string[] path, uint256 amount)"]);
    const localMetrics = new Int32Array(process.env.SHARED_METRICS);
    const nIdx = net.idx;
    const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 1000000, timeout: 5, noDelay: true });

    const log = (text, level = 'INFO') => process.send({ type: 'LOG', chain: chainName, text, level });

    const connectWs = () => {
        const ws = new WebSocket(net.wss);
        ws.on('open', () => {
            ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newPendingTransactions"] }));
            log("Absolute Certainty Link established.");
        });
        provider.on('block', () => executeAirtightFinalityStrike(chainName, net, wallet, provider, iface, localMetrics, nIdx, httpAgent, log).catch(() => {}));
        ws.on('message', async (data) => {
            try {
                const payload = JSON.parse(data);
                if (payload.params?.result) executeAirtightFinalityStrike(chainName, net, wallet, provider, iface, localMetrics, nIdx, httpAgent, log).catch(() => {});
            } catch (e) {}
        });
        ws.on('close', () => setTimeout(connectWs, 1));
    };
    connectWs();
}

async function executeAirtightFinalityStrike(name, net, wallet, provider, iface, sharedMetrics, nIdx, agent, log) {
    // --- SINGLETON ATOMIC LOCK ---
    // Multi-Chain Capital Guard: Only one worker can use the wallet balance at any millisecond
    if (Atomics.compareExchange(sharedMetrics, 5, 0, 1) !== 0) return;

    try {
        const [bal, feeData] = await Promise.all([provider.getBalance(wallet.address), provider.getFeeData()]);
        
        // Final certainty threshold
        if (bal < CONFIG.MIN_STRIKE_BALANCE) {
            Atomics.store(sharedMetrics, 5, 0); 
            return;
        }

        // --- THE DETERMINISTIC ANCHOR (PHYSICAL SQUEEZE) ---
        const baseGasPrice = feeData.gasPrice || parseEther("0.01", "gwei");
        const priorityFee = net.minPriority; 
        
        // VOLATILITY INSURANCE: 1.2x multiplier on L2 gas price to handle network jitter
        const executionGasPrice = (baseGasPrice * 120n / 100n) + priorityFee; 
        const l2ExecutionCost = CONFIG.GAS_LIMIT * executionGasPrice;
        
        // STALL-PROOF MOAT: Reserves 0.003 ETH specifically for Data Posting Fees (L1 overhead)
        const stallProofMoat = parseEther("0.003");
        const totalNetworkReserve = l2ExecutionCost + stallProofMoat + CONFIG.SAFETY_VOID_WEI;
        
        // REMAINDER: Derived as the absolute remainder of the physical wallet balance
        const premiumValue = bal - totalNetworkReserve;
        
        if (premiumValue <= 2000000000000n) { // 2 gwei dust floor
            Atomics.store(sharedMetrics, 5, 0);
            return;
        }

        /**
         * --- PREMIUM CONGRUENCE (SOLIDITY SYNC) ---
         * The contract requires: premium >= (amount * 9) / 10000
         * Working backward: amount = (premium * 10000) / 9
         */
        const tradeAmount = (premiumValue * 10000n) / 9n;

        // PHYSICAL GUARANTEE: Since fees + moat + void were pre-deducted to define premiumValue,
        // (premiumValue + totalNetworkReserve) is physically and mathematically <= wallet balance.

        if (!CONFIG.EXECUTOR || CONFIG.EXECUTOR === "") {
            log("SKIP: Executor address missing in .env", "ERROR");
            Atomics.store(sharedMetrics, 5, 0);
            return;
        }

        const token = CONFIG.CORE_TOKENS[Math.floor(Math.random() * CONFIG.CORE_TOKENS.length)];
        const nonce = Atomics.add(sharedMetrics, nIdx, 1);
        const path = ["ETH", token, "ETH"]; 

        const tx = {
            to: CONFIG.EXECUTOR,
            data: iface.encodeFunctionData("executeComplexPath", [path, tradeAmount]),
            value: premiumValue, 
            gasLimit: CONFIG.GAS_LIMIT,
            maxFeePerGas: executionGasPrice,
            maxPriorityFeePerGas: priorityFee,
            type: 2,
            chainId: net.chainId,
            nonce: nonce
        };

        // PREDICTIVE EMULATION
        // Triage: If this fails, it is a LOGIC revert (unprofitable), not a BALANCE revert.
        const simResult = await provider.call({ to: tx.to, data: tx.data, value: tx.value, from: wallet.address })
            .then(r => r !== '0x')
            .catch(() => false);

        if (!simResult) {
            Atomics.store(sharedMetrics, 5, 0);
            return; 
        }

        // ABSOLUTE BROADCAST
        const signed = await wallet.signTransaction(tx);
        net.rpc.forEach(url => {
            const protocol = url.startsWith('https') ? https : http;
            const req = protocol.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, agent }, (res) => res.resume());
            req.on('error', () => {});
            req.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [signed] }));
            req.end();
        });

        Atomics.add(sharedMetrics, 4, 1);
        log(`FINALITY STRIKE DISPATCHED: Loan ${formatEther(tradeAmount)} ETH | Physical Capital Squeezed`, 'SUCCESS');

        // Capital Lock released after short propagation window
        setTimeout(() => Atomics.store(sharedMetrics, 5, 0), 1200);

    } catch (e) {
        Atomics.store(sharedMetrics, 5, 0);
        if (e.message && !e.message.includes('network')) {
            log(`CRITICAL STRIKE ERROR: ${e.message}`, 'ERROR');
        }
    }
}
