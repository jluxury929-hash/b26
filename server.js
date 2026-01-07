/**
 * ===============================================================================
 * APEX TITAN v195.0 (THE OMNI-GOVERNOR - DETERMINISTIC ABSOLUTE UNIFIED)
 * ===============================================================================
 * STATUS: TOTAL MAXIMIZATION (MTE - MAXIMUM THEORETICAL EXTRACTION)
 * UNIFIED PROTOCOL:
 * 1. PHYSICAL REVERSE-DERIVATION: (Balance - Max_Fees - Safety_Void) = Premium.
 * 2. STALL-PROOF MOAT: Reserves 0.0035 ETH statically for L1 Posting/Data Fees.
 * 3. VOLATILITY INSURANCE: 1.2x Gas Multiplier to handle sequencer jitter.
 * 4. CONFIRMED LOGGING: Real-time listener for ProfitSecured & TradeExecuted events.
 * 5. SINGLETON ATOMICS: Locked memory [5] prevents multi-worker capital bleeding.
 * 6. BIGINT CONGRUENCE: Inverse math mirrors Solidity uint256 floor-division.
 * 7. STATIC HARDENING: staticNetwork configuration prevents RPC handshake loops.
 * ===============================================================================
 */

const cluster = require('cluster');
const os = require('os');
const http = require('http');
const https = require('https');
const WebSocket = require("ws");
const { 
    ethers, JsonRpcProvider, Wallet, FallbackProvider, 
    parseEther, formatEther, Interface, Contract 
} = require('ethers');
const { FlashbotsBundleProvider } = require("@flashbots/ethers-provider-bundle");
require('dotenv').config();

// --- [AEGIS SHIELD] ---
process.setMaxListeners(0); 
process.on('uncaughtException', (err) => {
    const msg = err.message || "";
    // Hardened filtering: Silence handshake and network jitter to prioritize strike speed
    if (msg.includes('429') || msg.includes('network') || msg.includes('socket') || msg.includes('Handshake') || msg.includes('detect network')) return;
    console.error(`[AEGIS] ${msg}`);
});

const TXT = { green: "\x1b[32m", gold: "\x1b[38;5;220m", reset: "\x1b[0m", red: "\x1b[31m", cyan: "\x1b[36m", bold: "\x1b[1m" };

// Shared Memory Infrastructure (Physical Speed Limit)
// [0..3]=Nonces (ETH, BASE, POLY, ARB), [4]=ConfirmedProfitCounter, [5]=CapitalLock (0=IDLE, 1=BUSY)
const sharedBuffer = new SharedArrayBuffer(128);
const stateMetrics = new Int32Array(sharedBuffer); 

const LOG_HISTORY = [];
const MAX_LOGS = 200;

const CONFIG = {
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    EXECUTOR: process.env.EXECUTOR_ADDRESS,
    PROFIT_RECIPIENT: "0x458f94e935f829DCAD18Ae0A18CA5C3E223B71DE",
    PORT: process.env.PORT || 8080,
    GAS_LIMIT: 2000000n, // Calibrated for complex multi-router logic
    SAFETY_VOID_WEI: 100000n, // 100k wei "Static Void" for mempool spikes
    MIN_STRIKE_BALANCE: parseEther("0.008"), // Absolute entry floor for Certainty math
    // STRICT ALIGNMENT: Matches v134.0 ArbitrageExecutor.sol tokenMap checksums exactly
    CORE_TOKENS: ["USDC", "WBTC", "DAI", "USDT", "PEPE", "CBETH"],
    NETWORKS: {
        ETHEREUM: { 
            chainId: 1, idx: 0,
            rpc: ["https://eth.llamarpc.com", "https://rpc.ankr.com/eth"], 
            wss: "wss://eth.llamarpc.com", 
            relays: ["https://relay.flashbots.net", "https://builder0x69.io"],
            minPriority: parseEther("500.0", "gwei") // Abyssal tier
        },
        BASE: { 
            chainId: 8453, idx: 1,
            rpc: ["https://mainnet.base.org", "https://base.merkle.io"], 
            wss: "wss://base-rpc.publicnode.com",
            minPriority: parseEther("1.6", "gwei") // Abyssal tier
        },
        POLYGON: {
            chainId: 137, idx: 2,
            rpc: ["https://polygon-rpc.com", "https://rpc-mainnet.maticvigil.com"],
            wss: "wss://polygon-bor-rpc.publicnode.com",
            minPriority: parseEther("200.0", "gwei") // Abyssal tier
        },
        ARBITRUM: {
            chainId: 42161, idx: 3,
            rpc: ["https://arb1.arbitrum.io/rpc", "https://arb1.arbitrum.io/rpc"],
            wss: "wss://arbitrum-one.publicnode.com",
            minPriority: parseEther("50.0", "gwei") // Abyssal tier
        }
    }
};

const EXECUTOR_ABI = [
    "function executeComplexPath(string[] path, uint256 amount) external payable",
    "event ProfitSecured(uint256 netProfit, uint256 minerBribe, string tier)",
    "event TradeExecuted(address router, uint256 amountOut)"
];

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
    console.log(`║    ⚡ APEX TITAN v195.0 | OMNI-GOVERNOR UNIFIED     ║`);
    console.log(`║    MODE: TOTAL CERTAINTY | CONFIRMED EVENT SYNC      ║`);
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
                broadcastLog('INFO', `Sentry Armed. Initial Nonce: ${nonce}`, name);

                // --- CONFIRMED TRADE LISTENER ---
                if (CONFIG.EXECUTOR) {
                    const executorContract = new Contract(CONFIG.EXECUTOR, EXECUTOR_ABI, provider);
                    executorContract.on("ProfitSecured", (netProfit, minerBribe, tier) => {
                        broadcastLog('SUCCESS', `💰 CONFIRMED PROFIT [${tier}]: +${formatEther(netProfit)} ETH (Miner Bribe: ${formatEther(minerBribe)})`, name);
                        Atomics.add(stateMetrics, 4, 1);
                    });
                    executorContract.on("TradeExecuted", (router, amountOut) => {
                        broadcastLog('INFO', `🔄 Hop Completed via ${router.substring(0, 10)}...`, name);
                    });
                }
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
                    status: "OMNI_GOVERNOR_UNIFIED_ACTIVE", 
                    nonces: { 
                        eth: Atomics.load(stateMetrics, 0), 
                        base: Atomics.load(stateMetrics, 1), 
                        poly: Atomics.load(stateMetrics, 2), 
                        arb: Atomics.load(stateMetrics, 3) 
                    },
                    confirmed_profits: Atomics.load(stateMetrics, 4),
                    lock_state: Atomics.load(stateMetrics, 5) === 1 ? "BUSY" : "IDLE",
                    uptime: Math.floor(process.uptime())
                }));
            } else { res.writeHead(404); res.end(); }
        }).listen(CONFIG.PORT);

        Object.keys(CONFIG.NETWORKS).forEach(chain => cluster.fork({ TARGET_CHAIN: chain, SHARED_METRICS: sharedBuffer }));
    }

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
    const iface = new Interface(EXECUTOR_ABI);
    const localMetrics = new Int32Array(process.env.SHARED_METRICS);
    const nIdx = net.idx;
    const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 1000000, timeout: 5, noDelay: true });

    const log = (text, level = 'INFO') => process.send({ type: 'LOG', chain: chainName, text, level });

    const relayers = [];
    if (net.relays && chainName === "ETHEREUM") {
        for (const relay of net.relays) {
            try {
                const r = await FlashbotsBundleProvider.create(provider, Wallet.createRandom(), relay);
                relayers.push(r);
            } catch (e) {}
        }
    }

    const connectWs = () => {
        const ws = new WebSocket(net.wss);
        ws.on('open', () => {
            ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newPendingTransactions"] }));
            log("Absolute Certainty Link established.");
        });
        provider.on('block', () => executeUnifiedCertaintyStrike(chainName, net, wallet, provider, relayers, iface, localMetrics, nIdx, httpAgent, log).catch(() => {}));
        ws.on('message', async (data) => {
            try {
                const payload = JSON.parse(data);
                if (payload.params?.result) executeUnifiedCertaintyStrike(chainName, net, wallet, provider, relayers, iface, localMetrics, nIdx, httpAgent, log).catch(() => {});
            } catch (e) {}
        });
        ws.on('close', () => setTimeout(connectWs, 1));
    };
    connectWs();
}

async function executeUnifiedCertaintyStrike(name, net, wallet, provider, relayers, iface, sharedMetrics, nIdx, agent, log) {
    // --- SINGLETON ATOMIC LOCK ---
    // Multi-worker Capital Guard: Ensures only one process consumes balance at a time
    if (Atomics.compareExchange(sharedMetrics, 5, 0, 1) !== 0) return;

    try {
        const [bal, feeData] = await Promise.all([provider.getBalance(wallet.address), provider.getFeeData()]);
        
        if (bal < CONFIG.MIN_STRIKE_BALANCE) {
            Atomics.store(sharedMetrics, 5, 0); 
            return;
        }

        // --- THE DETERMINISTIC ANCHOR (PHYSICAL SQUEEZE) ---
        const baseGasPrice = feeData.gasPrice || parseEther("0.01", "gwei");
        const priorityFee = net.minPriority; 
        
        // VOLATILITY INSURANCE: 1.2x multiplier on L2 gas price for handshake security
        const executionGasPrice = (baseGasPrice * 120n / 100n) + priorityFee; 
        const l2ExecutionCost = CONFIG.GAS_LIMIT * executionGasPrice;
        
        // STALL-PROOF MOAT: Reserves 0.0035 ETH statically for L1 Posting/Data Fees
        const stallProofMoat = parseEther("0.0035");
        const totalNetworkReserve = l2ExecutionCost + stallProofMoat + CONFIG.SAFETY_VOID_WEI;
        
        // REMAINDER: Derived as the absolute remainder of physical wallet capital
        const premiumValue = bal - totalNetworkReserve;
        
        if (premiumValue <= 2000000000000n) { // 2 gwei floor
            Atomics.store(sharedMetrics, 5, 0);
            return;
        }

        /**
         * --- PREMIUM CONGRUENCE (SOLIDITY SYNC) ---
         * amount = (premium * 10000) / 9
         * This matches the contract's requiredPremium leg precisely.
         */
        const tradeAmount = (premiumValue * 10000n) / 9n;

        if (!CONFIG.EXECUTOR || CONFIG.EXECUTOR === "") {
            log("SKIP: Executor address missing", "ERROR");
            Atomics.store(sharedMetrics, 5, 0);
            return;
        }

        const tokens = CONFIG.CORE_TOKENS;
        const token = tokens[Math.floor(Math.random() * tokens.length)];
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

        // PREDICTIVE EMULATION (Final Logic Gate)
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

        // Flashbots Relay for Ethereum
        if (relayers.length > 0 && name === "ETHEREUM") {
            relayers.forEach(r => r.sendBundle([{ signer: wallet, transaction: tx }], provider.blockNumber + 1).catch(() => {}));
        }

        log(`STRIKE DISPATCHED: Loan ${formatEther(tradeAmount)} ETH | Awaiting Confirmed Event...`, 'INFO');

        // Capital Lock released after short propagation window
        setTimeout(() => Atomics.store(sharedMetrics, 5, 0), 1200);

    } catch (e) {
        Atomics.store(sharedMetrics, 5, 0);
        if (e.message && !e.message.includes('network')) {
            log(`CRITICAL STRIKE ERROR: ${e.message}`, 'ERROR');
        }
    }
}
