import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import { configVariable, defineConfig } from "hardhat/config";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const accounts = [configVariable("DEPLOYER_PRIVATE_KEY")];

export default defineConfig({
  plugins: [hardhatEthers],
  solidity: {
    version: "0.8.27",
    settings: {
      evmVersion: "paris",
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    default: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 31337,
    },
    localhost: {
      type: "http",
      url: process.env.HARDHAT_NETWORK_URL || "http://127.0.0.1:8545",
      chainId: 31337,
    },
    sepolia: {
      type: "http",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts,
      chainId: 11155111,
      gasMultiplier: 1.2,
    },
    besu: {
      type: "http",
      url: configVariable("BESU_RPC_URL"),
      accounts,
      chainId: Number(process.env.BESU_CHAIN_ID || "1337"),
    },
  },
});
