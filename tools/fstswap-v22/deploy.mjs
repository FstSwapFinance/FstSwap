import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interface, JsonRpcProvider, ZeroAddress, getAddress, getCreateAddress, keccak256, toQuantity, toUtf8Bytes } from 'ethers';

const root = fileURLToPath(new URL('../../', import.meta.url));
const compiler = '0.8.26+commit.8a97fa7a.Emscripten.clang';
const version = '2.2.0';
const BNCB = '0x4902c5ebc598265ed2212b559b042de8a5eeec3f';
const deployer = '0x3D91889209f9ca69b7Cb73D7a8C463f4deFB5c15';
const receiver = '0x66f2B90E9fAEf07E5931A3483882804B78f92Ae9';
const USDT = '0x55d398326f99059fF775485246999027B3197955';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const quoter = '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997';
const referenceBlock = { number: '0x8100a08', hash: '0x4327b380372b05f39009eb503ed3d370ff00e559130e284202e8a3efc6ca1928' };
const steps = ['router', 'fst', 'pancake', 'v3', 'register-fst', 'register-pancake', 'register-v3'];
const definitions = {
  router: { name: 'FstSwap', source: 'contracts/fstswap-v22/src/FstSwap.sol' },
  fst: { name: 'FstSwapAdapter56', source: 'contracts/fstswap-v21/src/FstSwapAdapter56.sol', dex: '0x1B6C9c20693afDE803B27F8782156c0f892ABC2d', wrapped: '0x0efb5FD2402A0967B92551d6AF54De148504A115', kind: 0 },
  pancake: { name: 'PancakeAdapter56', source: 'contracts/fstswap-v21/src/PancakeAdapter56.sol', dex: '0x10ED43C718714eb63d5aA57B78B54704E256024E', wrapped: WBNB, kind: 0 },
  v3: { name: 'PancakeV3Adapter', source: 'contracts/fstswap-v22/src/PancakeV3Adapter.sol', dex: '0x1b81D678ffb9C0263b24A97847620C99d213eB14', wrapped: WBNB, kind: 1 },
};
const sha256 = value => createHash('sha256').update(value).digest('hex');
const equalAddress = (actual, expected) => assert.equal(getAddress(actual), getAddress(expected));
const deployHash = /^[0-9a-f]{64}$/i;

async function compile() {
  const requireCompiler = createRequire(new URL('../quote-pipeline/package.json', import.meta.url));
  const solc = requireCompiler('solc');
  assert.equal(solc.version(), compiler, 'Unexpected Solidity compiler');
  const sources = {};
  async function load(name) {
    if (sources[name]) return;
    assert.ok(name.startsWith('contracts/fstswap-v22/') || name.startsWith('contracts/fstswap-v21/') || name.startsWith('@openzeppelin/'), `Unrecognized contract import ${name}`);
    const path = name.replace(/^@openzeppelin\//, 'contracts/v10/lib/openzeppelin-contracts/');
    const content = await readFile(resolve(root, path), 'utf8');
    sources[name] = { content };
    for (const match of content.matchAll(/\bimport\s+(?:[^;'"\n]*\bfrom\s+)?['"]([^'"]+)['"]\s*;/g)) {
      const target = match[1];
      await load(target.startsWith('.') ? posix.normalize(posix.join(posix.dirname(name), target)) : target);
    }
  }
  for (const { source } of Object.values(definitions)) await load(source);
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      optimizer: { enabled: true, runs: 100 }, viaIR: true, evmVersion: 'paris',
      outputSelection: { '*': { '*': ['abi', 'metadata', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter(error => error.severity === 'error');
  if (errors.length) throw Error(errors.map(error => error.formattedMessage).join('\n'));
  const artifacts = {};
  for (const [key, { source, name }] of Object.entries(definitions)) {
    const artifact = output.contracts[source][name];
    const runtimeBytes = artifact.evm.deployedBytecode.object.length / 2;
    const bytecode = `0x${artifact.evm.bytecode.object}`;
    assert.ok(runtimeBytes > 0 && runtimeBytes <= 24_576, `${name} exceeds the BSC runtime limit`);
    assert.ok(bytecode.length <= 2 + 2 * 49_000, `${name} initcode must leave room for constructor arguments`);
    artifacts[key] = {
      source, name, abi: artifact.abi, bytecode, bytecodeHash: keccak256(bytecode),
      deployedBytecode: `0x${artifact.evm.deployedBytecode.object}`, runtimeBytes,
      immutableReferences: artifact.evm.deployedBytecode.immutableReferences ?? {}, metadata: artifact.metadata,
    };
  }
  const routerAbi = new Interface(artifacts.router.abi);
  const adapterAbi = new Interface(artifacts.v3.abi);
  assert.ok(routerAbi.getFunction('isV3TradeToken') && routerAbi.getFunction('bncbIdentityVerified') && adapterAbi.getFunction('supportsExactBNCB'), 'Missing the V2.2 BNCB execution interfaces');
  const inputSha256 = sha256(JSON.stringify(input));
  const digest = keccak256(toUtf8Bytes(JSON.stringify({ version, chainId: 56, deployer, receiver, USDT, WBNB, quoter, inputSha256, definitions,
    creationHashes: Object.fromEntries(Object.entries(artifacts).map(([key, artifact]) => [key, artifact.bytecodeHash])) })));
  return { input, manifest: { version, chainId: 56, compiler, inputSha256, digest, status: 'candidate', deployer, owner: deployer, feeReceiver: receiver, platformFeeBps: 30, defaultFeeToken: USDT, WBNB, quoter, steps, contracts: artifacts } };
}

function makeTransaction(contracts, step, addresses, sender, nonce) {
  const artifact = contracts[step];
  const router = new Interface(contracts.router.abi);
  const transaction = { from: sender, value: '0x0', nonce: toQuantity(nonce) };
  if (artifact) {
    const args = step === 'router' ? [receiver, 30, sender] : step === 'v3' ? [addresses.router, WBNB, quoter] : [addresses.router];
    const iface = new Interface(artifact.abi);
    return { ...transaction, data: artifact.bytecode + iface.encodeDeploy(args).slice(2) };
  }
  const key = step.slice('register-'.length);
  return { ...transaction, to: addresses.router, data: router.encodeFunctionData('setAdapter', [addresses[key], definitions[key].kind, true]) };
}

function normalizeRuntime(runtime, artifact) {
  assert.equal(runtime.length, artifact.deployedBytecode.length, `${artifact.name} runtime length differs`);
  let normalized = runtime;
  for (const spans of Object.values(artifact.immutableReferences)) {
    for (const { start, length } of spans) {
      const offset = 2 + start * 2;
      normalized = normalized.slice(0, offset) + '0'.repeat(2 * length) + normalized.slice(offset + 2 * length);
    }
  }
  return normalized.toLowerCase();
}

async function verifyStep(provider, step, hash, expected, artifact) {
  const [transaction, receipt] = await Promise.all([
    provider.send('eth_getTransactionByHash', [hash]), provider.send('eth_getTransactionReceipt', [hash]),
  ]);
  assert.ok(transaction && receipt, `${step} awaits a confirmed receipt`);
  const block = await provider.send('eth_getBlockByNumber', [receipt.blockNumber, false]);
  assert.equal(receipt.status, '0x1', `${step} did not succeed`);
  assert.equal(transaction.hash, hash);
  assert.equal(receipt.transactionHash, hash);
  assert.equal(block?.hash, receipt.blockHash, `${step} receipt is not canonical`);
  assert.equal(transaction.blockHash, receipt.blockHash);
  assert.equal(transaction.blockNumber, receipt.blockNumber);
  assert.equal(BigInt(transaction.chainId), BigInt(expected.chainId));
  equalAddress(transaction.from, expected.from);
  equalAddress(receipt.from, expected.from);
  assert.equal(BigInt(transaction.nonce), BigInt(expected.nonce));
  assert.equal(BigInt(transaction.value), 0n);
  assert.equal(transaction.input.toLowerCase(), expected.data.toLowerCase());
  if (!artifact) {
    equalAddress(transaction.to, expected.to);
    equalAddress(receipt.to, expected.to);
    assert.equal(receipt.contractAddress, null);
    return null;
  }
  assert.equal(transaction.to, null);
  assert.equal(receipt.to, null);
  const address = getCreateAddress({ from: expected.from, nonce: BigInt(expected.nonce) });
  equalAddress(receipt.contractAddress, address);
  const code = await provider.send('eth_getCode', [address, receipt.blockNumber]);
  assert.equal(normalizeRuntime(code, artifact), normalizeRuntime(artifact.deployedBytecode, artifact));
  return address;
}

async function verifyConfiguration(provider, artifacts, addresses, sender, completedSteps) {
  if (!addresses.router) return;
  const anchor = await provider.send('eth_getBlockByNumber', ['latest', false]);
  assert.ok(anchor?.hash);
  const call = async (target, abi, method, args = []) => {
    const iface = new Interface(abi);
    const data = iface.encodeFunctionData(method, args);
    return iface.decodeFunctionResult(method, await provider.send('eth_call', [{ to: target, data }, anchor.number]));
  };
  const atRouter = async (method, args) => (await call(addresses.router, artifacts.router.abi, method, args))[0];
  const [owner, feeReceiver, fee, defaultFee, deployVersion, wrapped, bncbV3, bncbFee, integrity, configVersion] = await Promise.all([
    atRouter('owner'), atRouter('feeReceiver'), atRouter('platformFeeBps'), atRouter('defaultFeeToken'),
    atRouter('VERSION'), atRouter('WBNB'), atRouter('isV3TradeToken', [BNCB]), atRouter('isFeeToken', [BNCB]),
    atRouter('bncbIdentityVerified'), atRouter('feeConfigVersion'),
  ]);
  equalAddress(owner, sender);
  equalAddress(feeReceiver, receiver);
  equalAddress(defaultFee, USDT);
  equalAddress(wrapped, WBNB);
  assert.equal(fee, 30n);
  assert.equal(deployVersion, version);
  assert.equal(bncbV3, true);
  assert.equal(bncbFee, false);
  assert.equal(integrity, true, 'Cannot verify the current BNCB proxy, beacon and implementation');
  assert.equal(configVersion, 1n + BigInt(Math.max(0, completedSteps - 4)));

  await Promise.all(['fst', 'pancake', 'v3'].filter(key => addresses[key]).map(async key => {
    const { kind, dex, wrapped } = definitions[key];
    const address = addresses[key], abi = artifacts[key].abi;
    const atAdapter = async method => (await call(address, abi, method))[0];
    const [aggregator, target, weth, info] = await Promise.all([
      atAdapter('aggregator'), atAdapter('router'), atAdapter('weth'), call(addresses.router, artifacts.router.abi, 'adapterInfo', [address]),
    ]);
    equalAddress(aggregator, addresses.router);
    equalAddress(weth, wrapped);
    equalAddress(target, dex);
    if (key === 'v3') {
      equalAddress(await atAdapter('quoter'), quoter);
      assert.equal(await atAdapter('supportsExactBNCB'), true);
    }
    const [enabled, actualKind, actualFactory, actualWrapped] = info.length === 1 ? info[0] : info;
    assert.equal(enabled, steps.indexOf(`register-${key}`) < completedSteps);
    if (enabled) {
      assert.equal(actualKind, BigInt(kind));
      equalAddress(actualWrapped, weth);
      const [factory] = await call(kind === 1 ? quoter : dex, ['function factory() view returns (address)'], 'factory');
      assert.notEqual(factory, ZeroAddress);
      equalAddress(actualFactory, factory);
    }
  }));
  assert.equal((await provider.send('eth_getBlockByNumber', [anchor.number, false]))?.hash, anchor.hash, 'Configuration anchor reorganized');
  return { blockNumber: anchor.number, blockHash: anchor.hash };
}

async function main() {
  const [command, argument, ...extra] = process.argv.slice(2);
  assert.ok(['build', 'plan', 'rehearse'].includes(command) && !extra.length, 'Usage: node deploy.mjs build <output-dir> | plan [records.json] | rehearse <loopback-Anvil-url>');
  const { input, manifest } = await compile();
  if (command === 'build') {
    assert.ok(argument, 'Specify a directory for deployment artifacts');
    const output = resolve(argument);
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, 'standard-input.json'), JSON.stringify(input, null, 2) + '\n');
    await writeFile(resolve(output, 'deployment-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    return { output, version, digest: manifest.digest, inputSha256: manifest.inputSha256, runtimeBytes: Object.fromEntries(Object.entries(manifest.contracts).map(([key, shape]) => [key, shape.runtimeBytes])) };
  }
  const rehearsal = command === 'rehearse';
  const url = new URL(rehearsal ? argument : process.env.FSTSWAP_DEPLOYMENT_RPC || 'https://bsc-rpc.publicnode.com');
  if (rehearsal) {
    assert.ok(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !!url.port && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Rehearsal requires an explicit Anvil loopback port');
  } else {
    assert.ok(url.protocol === 'https:' && !url.username && !url.password && !url.hash, 'Mainnet planning requires HTTPS without credentials in the authority');
  }
  const provider = new JsonRpcProvider(url.toString(), undefined, { batchMaxCount: 1 });
  try {
    const chainId = rehearsal ? 31337 : 56;
    assert.equal(BigInt(await provider.send('eth_chainId', [])), BigInt(chainId));
    assert.equal((await provider.send('eth_getBlockByNumber', [referenceBlock.number, false]))?.hash, referenceBlock.hash, 'RPC disagrees with the BSC reference block');
    if (rehearsal) assert.match(await provider.send('web3_clientVersion', []), /anvil/i);
    const sender = rehearsal ? getAddress((await provider.send('eth_accounts', []))[0]) : deployer;
    const recorded = !rehearsal && argument ? JSON.parse(await readFile(argument, 'utf8')) : { digest: manifest.digest, receipts: [] };
    assert.equal(recorded.digest, manifest.digest, 'Records belong to a different compilation');
    const receipts = recorded.receipts;
    assert.ok(Array.isArray(receipts) && receipts.length <= steps.length && receipts.every(hash => typeof hash === 'string' && hash.startsWith('0x') && deployHash.test(hash.slice(2)) && hash === hash.toLowerCase()) && new Set(receipts).size === receipts.length, 'Provide unique lowercase transaction hashes in step order');
    const addresses = {};
    const start = receipts.length ? BigInt((await provider.send('eth_getTransactionByHash', [receipts[0]]))?.nonce) : BigInt(await provider.send('eth_getTransactionCount', [sender, 'latest']));
    for (const [index, step] of steps.entries()) {
      const nonce = start + BigInt(index);
      const transaction = { ...makeTransaction(manifest.contracts, step, addresses, sender, nonce), chainId: toQuantity(chainId) };
      if (rehearsal) {
        const estimate = BigInt(await provider.send('eth_estimateGas', [transaction]));
        receipts.push(await provider.send('eth_sendTransaction', [{ ...transaction, gas: toQuantity(estimate * 6n / 5n) }]));
      }
      if (index === receipts.length) {
        await verifyConfiguration(provider, manifest.contracts, addresses, sender, index);
        const pending = BigInt(await provider.send('eth_getTransactionCount', [sender, 'pending']));
        assert.equal(pending, nonce, 'Wallet nonce changed, verify any existing transaction before creating another plan');
        const gas = BigInt(await provider.send('eth_estimateGas', [transaction]));
        assert.equal(BigInt(await provider.send('eth_getTransactionCount', [sender, 'pending'])), nonce, 'Wallet nonce changed during estimation');
        return { version, chainId, digest: manifest.digest, receipts, nextStep: step, transaction: { ...transaction, gas: toQuantity(gas * 6n / 5n) } };
      }
      const address = await verifyStep(provider, step, receipts[index], transaction, manifest.contracts[step]);
      if (address) addresses[step] = address;
    }
    const verification = await verifyConfiguration(provider, manifest.contracts, addresses, sender, steps.length);
    return { version, chainId, digest: manifest.digest, status: rehearsal ? 'verified-local-fork' : 'verified-mainnet-candidate', receipts, addresses, verification };
  } finally {
    provider.destroy();
  }
}

try {
  console.log(JSON.stringify(await main(), null, 2));
} catch (error) {
  console.error(`FstSwap V2.2 deployment preparation failed: ${error.shortMessage ?? error.message}`);
  process.exitCode = 1;
}
