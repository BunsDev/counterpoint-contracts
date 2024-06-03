import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'
import * as envEnc from '@chainlink/env-enc'
envEnc.config()

const config: HardhatUserConfig = {
  solidity: '0.8.19',
  networks: {
    hardhat: {
      forking: {
        url: process.env.RPC_URL ? process.env.RPC_URL : 'error'
      }
    },
    amoy: {
      url: process.env.RPC_URL ? process.env.RPC_URL : 'error',
      chainId: 80002,
      hardfork: 'london'
    }
  },
  mocha: {
    timeout: 120000
  }
}

export default config
