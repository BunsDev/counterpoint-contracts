import {
  time,
  loadFixture
} from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { expect } from 'chai'
import { ethers } from 'ethers'
import { Wallet, Signer, providers, Contract, utils, BigNumber } from 'ethers-5'
import ABI from '../abi/counterpoint.json'
import { keccak256 } from '../utils'
import * as helpers from '@nomicfoundation/hardhat-network-helpers'
import fs from 'fs'
import path from 'path'
import * as envEnc from '@chainlink/env-enc'
import {
  decodeResult,
  FulfillmentCode,
  ResponseListener,
  ReturnType,
  SecretsManager,
  simulateScript,
  SubscriptionManager
} from '@chainlink/functions-toolkit'
envEnc.config()

interface Metadata {
  gpsLongitude: string
  gpsLatitude: string
  gpsLongitudeRef: string
  gpsLatitudeRef: string
  timestamp: number
  size: number
  format: string
}
interface Coordinates {
  lat: number
  lng: number
}
const gpsCoordinates1: Coordinates = {
  lat: 15.8713,
  lng: -97.080058
}
const metadataCoordinates1: Coordinates = {
  lat: 15.871978,
  lng: -97.078703
}
const gpsCoordinates2: Coordinates = {
  lat: 15.873072,
  lng: -97.081776
}
const metadataCoordinates2: Coordinates = {
  lat: 15.87092,
  lng: -97.094293
}
const request = {
  homeMobileCountryCode: 334,
  homeMobileNetworkCode: 20,
  radioType: 'lte',
  cellTowers: [
    {
      cellId: 52425731,
      locationAreaCode: 25309,
      mobileCountryCode: 334,
      mobileNetworkCode: 20,
      signalStrength: -114
    }
  ]
}
const routerAddress = '0xC22a79eBA640940ABB6dF0f7982cc119578E11De'
const linkTokenAddress = '0x0Fd9e8d3aF1aaee056EB9e802c3A762a667b1904'
const donId = 'fun-polygon-amoy-1'
const explorerUrl = 'https://www.oklink.com/amoy '
const gatewayUrls = [
  'https://01.functions-gateway.testnet.chain.link/',
  'https://02.functions-gateway.testnet.chain.link/'
]
const source = fs
  .readFileSync(path.resolve(__dirname, '../source.js'))
  .toString()
const subscriptionId = 239
const contractAddress = '0xAe6fAA517b75D575aA7ED7d3F8F09c6872aA9773'

const slotIdNumber = 0 // slot ID where to upload the secrets
const expirationTimeMinutes = 15 // expiration time in minutes of the secrets
const gasLimit = 300000
const args = [
  JSON.stringify(request),
  JSON.stringify(gpsCoordinates1),
  JSON.stringify(metadataCoordinates1)
]
const args2 = [
  JSON.stringify(request),
  JSON.stringify(gpsCoordinates2),
  JSON.stringify(metadataCoordinates2)
]

describe('Chainlunk functions', function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.

  describe('location verification', function () {
    it('Should return true if user is at location', async function () {
      const provider = new providers.JsonRpcProvider(process.env.RPC_URL)
      let signer
      if (process.env.PK) {
        const wallet = new Wallet(process.env.PK)
        signer = wallet.connect(provider)
      }
      if (!signer) throw new Error(`failed to initailize signer`)
      const counterpoint = new Contract(contractAddress, ABI, signer)
      if (!process.env.MAPS_API)
        throw new Error(`api key  - check your environment variables`)
      const secrets = { MAPS_API: process.env.MAPS_API }

      ///////// START SIMULATION ////////////

      console.log('Start simulation...')

      const response = await simulateScript({
        source: source,
        args: args,
        bytesArgs: [], // bytesArgs - arguments can be encoded off-chain to bytes.
        secrets: secrets
      })

      console.log('Simulation result', response)
      const errorString = response.errorString
      if (errorString) {
        console.log(`❌ Error during simulation: `, errorString)
      } else {
        const returnType = ReturnType.uint256
        const responseBytesHexstring = response.responseBytesHexstring
        if (
          responseBytesHexstring &&
          ethers.getBytes(responseBytesHexstring).length > 0
        ) {
          const decodedResponse = decodeResult(
            responseBytesHexstring,
            returnType
          )
          expect(decodedResponse).to.equal(0)
          console.log(`✅ Decoded response to ${returnType}: `, decodedResponse)
        }
      }

      // Initialize and return SubscriptionManager
      const subscriptionManager = new SubscriptionManager({
        signer: signer,
        linkTokenAddress: linkTokenAddress,
        functionsRouterAddress: routerAddress
      })
      await subscriptionManager.initialize()

      // estimate costs in Juels

      const gasPriceWei = await signer.getGasPrice() // get gasPrice in wei

      const estimatedCostInJuels =
        await subscriptionManager.estimateFunctionsRequestCost({
          donId: donId, // ID of the DON to which the Functions request will be sent
          subscriptionId: subscriptionId, // Subscription ID
          callbackGasLimit: gasLimit, // Total gas used by the consumer contract's callback
          gasPriceWei: gasPriceWei.toBigInt() // Gas price in gWei
        })

      console.log(
        `Fulfillment cost estimated to ${utils.formatEther(
          estimatedCostInJuels
        )} LINK`
      )
      // First encrypt secrets and upload the encrypted secrets to the DON
      const secretsManager = new SecretsManager({
        signer: signer,
        functionsRouterAddress: routerAddress,
        donId: donId
      })
      await secretsManager.initialize()

      // Encrypt secrets and upload to DON
      const encryptedSecretsObj = await secretsManager.encryptSecrets(secrets)

      console.log(
        `Upload encrypted secret to gateways ${gatewayUrls}. slotId ${slotIdNumber}. Expiration in minutes: ${expirationTimeMinutes}`
      )
      // Upload secrets
      const uploadResult = await secretsManager.uploadEncryptedSecretsToDON({
        encryptedSecretsHexstring: encryptedSecretsObj.encryptedSecrets,
        gatewayUrls: gatewayUrls,
        slotId: slotIdNumber,
        minutesUntilExpiration: expirationTimeMinutes
      })

      if (!uploadResult.success)
        throw new Error(`Encrypted secrets not uploaded to ${gatewayUrls}`)
      console.log(
        `\n✅ Secrets uploaded properly to gateways ${gatewayUrls}! Gateways response: `,
        uploadResult
      )

      const donHostedSecretsVersion = uploadResult.version
      console.log(await counterpoint.fee())

      const transaction = await counterpoint.sendRequest(
        source,
        '0x',
        slotIdNumber,
        donHostedSecretsVersion,
        args,
        [],
        subscriptionId,
        gasLimit,
        utils.formatBytes32String(donId)
      )
      // Log transaction details
      console.log(
        `\n✅ Functions request sent! Transaction hash ${transaction.hash}. Waiting for a response...`
      )

      console.log(
        `See your request in the explorer ${explorerUrl}/tx/${transaction.hash}`
      )
      const responseListener = new ResponseListener({
        provider: provider,
        functionsRouterAddress: routerAddress
      }) // Instantiate a ResponseListener object to wait for fulfillment.
      try {
        const response: any = await new Promise((resolve, reject) => {
          responseListener
            .listenForResponseFromTransaction(transaction.hash)
            .then((response) => {
              expect(
                decodeResult(
                  response.responseBytesHexstring,
                  ReturnType.uint256
                )
              ).to.equal(0)
              resolve(response) // Resolves once the request has been fulfilled.
            })
            .catch((error) => {
              reject(error) // Indicate that an error occurred while waiting for fulfillment.
            })
        })

        const fulfillmentCode = response.fulfillmentCode

        if (fulfillmentCode === FulfillmentCode.FULFILLED) {
          console.log(
            `\n✅ Request ${
              response.requestId
            } successfully fulfilled. Cost is ${utils.formatEther(
              response.totalCostInJuels
            )} LINK.Complete reponse: `,
            response
          )
        } else if (fulfillmentCode === FulfillmentCode.USER_CALLBACK_ERROR) {
          console.log(
            `\n⚠️ Request ${
              response.requestId
            } fulfilled. However, the consumer contract callback failed. Cost is ${utils.formatEther(
              response.totalCostInJuels
            )} LINK.Complete reponse: `,
            response
          )
        } else {
          console.log(
            `\n❌ Request ${
              response.requestId
            } not fulfilled. Code: ${fulfillmentCode}. Cost is ${utils.formatEther(
              response.totalCostInJuels
            )} LINK.Complete reponse: `,
            response
          )
        }

        const errorString = response.errorString
        if (errorString) {
          console.log(`\n❌ Error during the execution: `, errorString)
        } else {
          const responseBytesHexstring = response.responseBytesHexstring
          if (utils.arrayify(responseBytesHexstring).length > 0) {
            const decodedResponse = decodeResult(
              response.responseBytesHexstring,
              ReturnType.uint256
            )
            console.log(
              `\n✅ Decoded response to ${ReturnType.uint256}: `,
              decodedResponse
            )
          }
        }
      } catch (error) {
        console.error('Error listening for response:', error)
      }
    })
    it('Should return false if user is not at location', async function () {
      const provider = new providers.JsonRpcProvider(process.env.RPC_URL)
      let signer
      if (process.env.PK) {
        const wallet = new Wallet(process.env.PK)
        signer = wallet.connect(provider)
      }
      if (!signer) throw new Error(`failed to initailize signer`)
      const counterpoint = new Contract(contractAddress, ABI, signer)
      if (!process.env.MAPS_API)
        throw new Error(`api key  - check your environment variables`)
      const secrets = { MAPS_API: process.env.MAPS_API }

      ///////// START SIMULATION ////////////

      console.log('Start simulation...')

      const response = await simulateScript({
        source: source,
        args: args2,
        bytesArgs: [], // bytesArgs - arguments can be encoded off-chain to bytes.
        secrets: secrets
      })

      console.log('Simulation result', response)
      const errorString = response.errorString
      if (errorString) {
        console.log(`❌ Error during simulation: `, errorString)
      } else {
        const returnType = ReturnType.uint256
        const responseBytesHexstring = response.responseBytesHexstring
        if (
          responseBytesHexstring &&
          ethers.getBytes(responseBytesHexstring).length > 0
        ) {
          const decodedResponse = decodeResult(
            responseBytesHexstring,
            returnType
          )
          expect(decodedResponse).to.equal(1)
          console.log(`✅ Decoded response to ${returnType}: `, decodedResponse)
        }
      }

      // Initialize and return SubscriptionManager
      const subscriptionManager = new SubscriptionManager({
        signer: signer,
        linkTokenAddress: linkTokenAddress,
        functionsRouterAddress: routerAddress
      })
      await subscriptionManager.initialize()

      // estimate costs in Juels

      const gasPriceWei = await signer.getGasPrice() // get gasPrice in wei

      const estimatedCostInJuels =
        await subscriptionManager.estimateFunctionsRequestCost({
          donId: donId, // ID of the DON to which the Functions request will be sent
          subscriptionId: subscriptionId, // Subscription ID
          callbackGasLimit: gasLimit, // Total gas used by the consumer contract's callback
          gasPriceWei: gasPriceWei.toBigInt() // Gas price in gWei
        })

      console.log(
        `Fulfillment cost estimated to ${utils.formatEther(
          estimatedCostInJuels
        )} LINK`
      )
      // First encrypt secrets and upload the encrypted secrets to the DON
      const secretsManager = new SecretsManager({
        signer: signer,
        functionsRouterAddress: routerAddress,
        donId: donId
      })
      await secretsManager.initialize()

      // Encrypt secrets and upload to DON
      const encryptedSecretsObj = await secretsManager.encryptSecrets(secrets)

      console.log(
        `Upload encrypted secret to gateways ${gatewayUrls}. slotId ${slotIdNumber}. Expiration in minutes: ${expirationTimeMinutes}`
      )
      // Upload secrets
      const uploadResult = await secretsManager.uploadEncryptedSecretsToDON({
        encryptedSecretsHexstring: encryptedSecretsObj.encryptedSecrets,
        gatewayUrls: gatewayUrls,
        slotId: slotIdNumber,
        minutesUntilExpiration: expirationTimeMinutes
      })

      if (!uploadResult.success)
        throw new Error(`Encrypted secrets not uploaded to ${gatewayUrls}`)
      console.log(
        `\n✅ Secrets uploaded properly to gateways ${gatewayUrls}! Gateways response: `,
        uploadResult
      )

      const donHostedSecretsVersion = uploadResult.version

      const transaction = await counterpoint.sendRequest(
        source,
        '0x',
        slotIdNumber,
        donHostedSecretsVersion,
        args2,
        [],
        subscriptionId,
        gasLimit,
        utils.formatBytes32String(donId)
      )
      // Log transaction details
      console.log(
        `\n✅ Functions request sent! Transaction hash ${transaction.hash}. Waiting for a response...`
      )

      console.log(
        `See your request in the explorer ${explorerUrl}/tx/${transaction.hash}`
      )
      const responseListener = new ResponseListener({
        provider: provider,
        functionsRouterAddress: routerAddress
      }) // Instantiate a ResponseListener object to wait for fulfillment.
      try {
        const response: any = await new Promise((resolve, reject) => {
          responseListener
            .listenForResponseFromTransaction(transaction.hash)
            .then((response) => {
              expect(
                decodeResult(
                  response.responseBytesHexstring,
                  ReturnType.uint256
                )
              ).to.equal(1)
              resolve(response) // Resolves once the request has been fulfilled.
            })
            .catch((error) => {
              reject(error) // Indicate that an error occurred while waiting for fulfillment.
            })
        })

        const fulfillmentCode = response.fulfillmentCode

        if (fulfillmentCode === FulfillmentCode.FULFILLED) {
          console.log(
            `\n✅ Request ${
              response.requestId
            } successfully fulfilled. Cost is ${utils.formatEther(
              response.totalCostInJuels
            )} LINK.Complete reponse: `,
            response
          )
        } else if (fulfillmentCode === FulfillmentCode.USER_CALLBACK_ERROR) {
          console.log(
            `\n⚠️ Request ${
              response.requestId
            } fulfilled. However, the consumer contract callback failed. Cost is ${utils.formatEther(
              response.totalCostInJuels
            )} LINK.Complete reponse: `,
            response
          )
        } else {
          console.log(
            `\n❌ Request ${
              response.requestId
            } not fulfilled. Code: ${fulfillmentCode}. Cost is ${utils.formatEther(
              response.totalCostInJuels
            )} LINK.Complete reponse: `,
            response
          )
        }

        const errorString = response.errorString
        if (errorString) {
          console.log(`\n❌ Error during the execution: `, errorString)
        } else {
          const responseBytesHexstring = response.responseBytesHexstring
          if (utils.arrayify(responseBytesHexstring).length > 0) {
            const decodedResponse = decodeResult(
              response.responseBytesHexstring,
              ReturnType.uint256
            )
            console.log(
              `\n✅ Decoded response to ${ReturnType.uint256}: `,
              decodedResponse
            )
          }
        }
      } catch (error) {
        console.error('Error listening for response:', error)
      }
    })
  })
})
