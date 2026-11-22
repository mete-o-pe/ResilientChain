import fs from "node:fs";
import path from "node:path";
import { artifacts, network } from "hardhat";

const PUBLIC_DIR = path.join(import.meta.dirname, "../../frontend/public/contracts");
const PUB_ABI_DIR = path.join(PUBLIC_DIR, "abis");
const PUB_ADDR_FILE = path.join(PUBLIC_DIR, "addresses.json");
const DEPLOYMENTS_DIR = path.join(import.meta.dirname, "../deployments");

async function copyABI(contractName) {
  const artifact = await artifacts.readArtifact(contractName);
  // Copia para public/ (servido pelo browser)
  fs.mkdirSync(PUB_ABI_DIR, { recursive: true });
  fs.writeFileSync(path.join(PUB_ABI_DIR, `${contractName}.json`), JSON.stringify(artifact.abi, null, 2));
  console.log(`  ABI copiada: ${contractName}.json`);
}

async function main() {
  const { ethers, networkName } = await network.create();
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Saldo:   ", ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH\n");

  // ── 1. AccessManager (sem argumentos — deve ser primeiro) ───────────────
  console.log("Deployando AccessManager...");
  const AccessManager = await ethers.getContractFactory("AccessManager");
  const accessManager = await AccessManager.deploy();
  await accessManager.waitForDeployment();
  const accessManagerAddr = await accessManager.getAddress();
  console.log("  AccessManager:", accessManagerAddr);

  // ── 2. BIARegistry (recebe endereço do AccessManager) ───────────────────
  console.log("Deployando BIARegistry...");
  const BIARegistry = await ethers.getContractFactory("BIARegistry");
  const biaRegistry = await BIARegistry.deploy(accessManagerAddr);
  await biaRegistry.waitForDeployment();
  const biaRegistryAddr = await biaRegistry.getAddress();
  console.log("  BIARegistry:", biaRegistryAddr);

  // ── 3. BIAFileRegistry (recebe endereço do AccessManager) ───────────────
  console.log("Deployando BIAFileRegistry...");
  const BIAFileRegistry = await ethers.getContractFactory("BIAFileRegistry");
  const biaFileRegistry = await BIAFileRegistry.deploy(accessManagerAddr);
  await biaFileRegistry.waitForDeployment();
  const biaFileRegistryAddr = await biaFileRegistry.getAddress();
  console.log("  BIAFileRegistry:", biaFileRegistryAddr);

  // ── Copia ABIs para o frontend ──────────────────────────────────────────
  console.log("\nCopiando ABIs para frontend/public/contracts/abis/...");
  await copyABI("AccessManager");
  await copyABI("BIARegistry");
  await copyABI("BIAFileRegistry");

  // ── Salva endereços ─────────────────────────────────────────────────────
  const addresses = {
    AccessManager:   accessManagerAddr,
    BIARegistry:     biaRegistryAddr,
    BIAFileRegistry: biaFileRegistryAddr,
  }

  fs.writeFileSync(PUB_ADDR_FILE, JSON.stringify(addresses, null, 2));
  console.log("\n  ✅ addresses.json → frontend/public/contracts/addresses.json");

  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  const latestFile = path.join(DEPLOYMENTS_DIR, `${networkName}-latest.json`);
  const deployment = {
    network:        networkName,
    chainId:        String((await ethers.provider.getNetwork()).chainId),
    deployedAt:     new Date().toISOString(),
    deployedBy:     deployer.address,
    AccessManager:  accessManagerAddr,
    BIARegistry:    biaRegistryAddr,
    BIAFileRegistry: biaFileRegistryAddr,
    // aliases minúsculos para compatibilidade com copy-abis.js legado
    accessManager:   accessManagerAddr,
    biaRegistry:     biaRegistryAddr,
    biaFileRegistry: biaFileRegistryAddr,
  }
  fs.writeFileSync(latestFile, JSON.stringify(deployment, null, 2));
  console.log(`  ✅ ${path.basename(latestFile)} atualizado`);

  console.log("\nEndereços:");
  console.log(JSON.stringify(addresses, null, 2));
  console.log("\n✅ Deploy concluído! Recarregue o frontend (Cmd+Shift+R).");
}

main().catch(err => { console.error(err); process.exit(1); });
