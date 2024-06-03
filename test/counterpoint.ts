import {
  time,
  loadFixture
} from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import ABI from '../abi/counterpoint.json'
import { keccak256 } from '../utils'
import * as helpers from '@nomicfoundation/hardhat-network-helpers'
import fs from 'fs'
import path from 'path'
import ExifReader from 'exifreader'

interface Metadata {
  gpsLongitude: string
  gpsLatitude: string

  timestamp: number
}

interface Coordinates {
  lat: number
  lng: number
}

describe('counterpoint', function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployFixture() {
    await helpers.mine()
    // rest of the script
    // Contracts are deployed using the first signer/account by default
    const owner = await ethers.getImpersonatedSigner(
      '0x43Fd37b3587fB30E319De4A276AD49E7969E23DD'
    )
    const otherAccount = await ethers.getImpersonatedSigner(
      '0x290A03AF516d3FF193030C9363b53dF7d49d44Fb'
    )
    const source = fs.readFileSync('./source.js').toString()
    const subscriptionId = 239
    const contractAddress = '0xAe6fAA517b75D575aA7ED7d3F8F09c6872aA9773'
    const fee = 1
    const balance = 1
    const metadata: Metadata = {
      gpsLongitude: 'a',
      gpsLatitude: 'b',

      timestamp: 1000
    }

    const structType = 'tuple(string,string,uint256)'
    const encoder = ethers.AbiCoder.defaultAbiCoder()

    const metaHash = keccak256(
      encoder.encode(
        [structType],
        [[metadata.gpsLongitude, metadata.gpsLatitude, metadata.timestamp]]
      )
    )
    console.log('ethers metahash', metaHash)

    const dataHash = keccak256(encoder.encode(['string'], ['data']))

    const alteredDataHash = keccak256(encoder.encode(['string'], ['date']))

    const counterpoint = new ethers.Contract(contractAddress, ABI, owner)
    const gpsCoordinates1: Coordinates = {
      lat: 15.873072,
      lng: -97.081776
    }
    const metadataCoordinates1: Coordinates = {
      lat: 15.87092,
      lng: -97.094293
    }

    return {
      counterpoint,
      owner,
      otherAccount,
      fee,
      balance,
      metadata,
      metaHash,
      dataHash,
      alteredDataHash,
      contractAddress,
      source,
      subscriptionId,
      gpsCoordinates1,
      metadataCoordinates1
    }
  }
  describe('Deployment', function () {
    it('Should set the right fee', async function () {
      const { fee, counterpoint } = await loadFixture(deployFixture)

      expect(await counterpoint.fee()).to.equal(fee)
    })

    it('Should set the right owner', async function () {
      const { counterpoint, owner } = await loadFixture(deployFixture)

      expect(await counterpoint.owner()).to.equal(owner.address)
    })
  })

  describe('Withdrawals', function () {
    describe('Validations', function () {
      it('Should revert with the right error if called from another account', async function () {
        const { otherAccount, counterpoint, contractAddress } =
          await loadFixture(deployFixture)
        const contract = new ethers.Contract(contractAddress, ABI, otherAccount)

        // We use lock.connect() to send a transaction from another account
        await expect(contract.withdraw()).to.be.revertedWith(
          "You aren't the owner"
        )
      })
    })

    describe('Events', function () {
      it('Should emit an event on withdrawals', async function () {
        const { counterpoint } = await loadFixture(deployFixture)
        const provider = ethers.getDefaultProvider()

        await expect(counterpoint.withdraw()).to.emit(
          counterpoint,
          'Withdrawal'
        )
      })
    })

    describe('Transfers', function () {
      it('Should transfer the funds to the owner', async function () {
        const { counterpoint, owner, contractAddress } = await loadFixture(
          deployFixture
        )

        await expect(counterpoint.withdraw()).to.changeEtherBalances(
          [owner, counterpoint],
          [1, -1]
        )
      })
    })
  })
  describe('Storing hashes and metadata', function () {
    describe('saveHash', function () {
      it('Should save the correct data for a given metadata hash', async function () {
        const { counterpoint, metadata, metaHash, dataHash, owner } =
          await loadFixture(deployFixture)
        const reqId = await counterpoint.userLastRequestId(owner.address)
        console.log(reqId.toString())
        await counterpoint.saveHash(metadata, 'data', reqId, { value: 1 })

        expect(await counterpoint.getDataHash(metadata)).to.equal(dataHash)
      })
      it('Should revert with the correct error if the hash has already been saved', async function () {
        const { counterpoint, metadata, metaHash, dataHash, owner } =
          await loadFixture(deployFixture)
        const reqId = await counterpoint.userLastRequestId(owner.address)
        await counterpoint.saveHash(metadata, 'data', reqId, { value: 1 })
        await expect(
          counterpoint.saveHash(metadata, 'data', reqId, { value: 1 })
        ).to.be.revertedWithCustomError(counterpoint, 'HashAlreadySaved')
      })

      it('Should emit an event on saving hash', async function () {
        const { counterpoint, metadata, metaHash, dataHash, owner } =
          await loadFixture(deployFixture)
        const reqId = counterpoint.userLastRequestId(owner.address)

        await expect(
          counterpoint.saveHash(metadata, 'data', reqId, { value: 1 })
        )
          .to.emit(counterpoint, 'HashSaved')
          .withArgs(owner, Object.values(metadata))
      })
    })
  })
  describe('authenticate', function () {
    it('Should return true if data has not been altered', async function () {
      const { counterpoint, metadata, metaHash, dataHash, owner } =
        await loadFixture(deployFixture)
      const reqId = counterpoint.userLastRequestId(owner.address)
      await counterpoint.saveHash(metadata, 'data', reqId, { value: 1 })
      expect(await counterpoint.authenticate(metadata, 'data')).to.true
    })

    it('Should return false if data has been altered', async function () {
      const {
        counterpoint,
        metadata,
        metaHash,
        dataHash,
        alteredDataHash,
        owner
      } = await loadFixture(deployFixture)
      const reqId = counterpoint.userLastRequestId(owner.address)
      await counterpoint.saveHash(metadata, 'data', reqId, { value: 1 })
      expect(await counterpoint.authenticate(metadata, 'date')).to.false
    })
  })
  describe('getters', function () {
    it('Should get the correct metadata given a metadata hash', async function () {
      const { counterpoint, metadata, metaHash, dataHash, owner } =
        await loadFixture(deployFixture)
      const reqId = counterpoint.userLastRequestId(owner.address)
      await counterpoint.saveHash(metadata, 'data', reqId, { value: 1 })
      const response = await counterpoint.getMetaData(metaHash)
      const valueArray = Object.values(metadata)

      expect(response[0]).to.equal(valueArray[0])
      expect(response[1]).to.equal(valueArray[1])
      expect(response[2]).to.equal(valueArray[2])
    })

    it('Should get the correct data hash given a meta data hash', async function () {
      const { counterpoint, metadata, metaHash, dataHash, owner } =
        await loadFixture(deployFixture)
      const reqId = counterpoint.userLastRequestId(owner.address)
      await counterpoint.saveHash(metadata, 'data', reqId, { value: 1 })

      expect(await counterpoint.getDataHash(metadata)).to.equal(dataHash)
    })
  })
})
