import {
  time,
  loadFixture
} from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { keccak256 } from '../utils'

interface Metadata {
  gpsLongitude: string
  gpsLatitude: string
  gpsLongitudeRef: string
  gpsLatitudeRef: string
  timestamp: number
  size: number
  format: string
}

describe('Authentichain', function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployFixture() {
    // Contracts are deployed using the first signer/account by default
    const [owner, otherAccount] = await ethers.getSigners()
    const fee = 1
    const balance = 1
    const metadata: Metadata = {
      gpsLongitude: 'a',
      gpsLatitude: 'b',
      gpsLongitudeRef: 'c',
      gpsLatitudeRef: 'd',
      timestamp: 1000,
      size: 100,
      format: 'f'
    }
    const structType =
      'tuple(string,string,string,string,uint256,uint256,string)'
    const encoder = ethers.AbiCoder.defaultAbiCoder()

    const metaHash = keccak256(
      encoder.encode(
        [structType],
        [
          [
            metadata.gpsLongitude,
            metadata.gpsLatitude,
            metadata.gpsLongitudeRef,
            metadata.gpsLatitudeRef,
            metadata.timestamp,
            metadata.size,
            metadata.format
          ]
        ]
      )
    )
    console.log('ethers metahash', metaHash)

    const dataHash = keccak256(encoder.encode(['string'], ['data']))

    const alteredDataHash = keccak256(encoder.encode(['string'], ['date']))

    const Authentichain = await ethers.getContractFactory('Authentichain')
    const authentichain = await Authentichain.deploy(fee, { value: balance })

    return {
      authentichain,
      owner,
      otherAccount,
      fee,
      balance,
      metadata,
      metaHash,
      dataHash,
      alteredDataHash
    }
  }
  describe('Deployment', function () {
    it('Should set the right fee', async function () {
      const { fee, authentichain } = await loadFixture(deployFixture)

      expect(await authentichain.fee()).to.equal(fee)
    })

    it('Should set the right owner', async function () {
      const { authentichain, owner } = await loadFixture(deployFixture)

      expect(await authentichain.owner()).to.equal(owner.address)
    })
  })

  describe('Withdrawals', function () {
    describe('Validations', function () {
      it('Should revert with the right error if called from another account', async function () {
        const { authentichain, otherAccount } = await loadFixture(deployFixture)

        // We use lock.connect() to send a transaction from another account
        await expect(
          authentichain.connect(otherAccount).withdraw()
        ).to.be.revertedWith("You aren't the owner")
      })
    })

    describe('Events', function () {
      it('Should emit an event on withdrawals', async function () {
        const { authentichain, balance } = await loadFixture(deployFixture)

        await expect(authentichain.withdraw())
          .to.emit(authentichain, 'Withdrawal')
          .withArgs(balance, anyValue) // We accept any value as `when` arg
      })
    })

    describe('Transfers', function () {
      it('Should transfer the funds to the owner', async function () {
        const { authentichain, balance, owner } = await loadFixture(
          deployFixture
        )

        await expect(authentichain.withdraw()).to.changeEtherBalances(
          [owner, authentichain],
          [balance, -balance]
        )
      })
    })
  })
  describe('Storing hashes and metadata', function () {
    describe('saveHash', function () {
      it('Should save the correct data for a given metadata hash', async function () {
        const { authentichain, metadata, metaHash, dataHash } =
          await loadFixture(deployFixture)

        await authentichain.saveHash(metadata, 'data')

        expect(await authentichain.getDataHash(metadata)).to.equal(dataHash)
      })
      it('Should revert with the correct error if the hash has already been saved', async function () {
        const { authentichain, metadata, metaHash, dataHash } =
          await loadFixture(deployFixture)

        await authentichain.saveHash(metadata, 'data')
        await expect(
          authentichain.saveHash(metadata, 'data')
        ).to.be.revertedWithCustomError(authentichain, 'HashAlreadySaved')
      })

      it('Should emit an event on saving hash', async function () {
        const { authentichain, metadata, metaHash, dataHash, owner } =
          await loadFixture(deployFixture)

        await expect(authentichain.saveHash(metadata, 'data'))
          .to.emit(authentichain, 'HashSaved')
          .withArgs(owner, Object.values(metadata))
      })
    })
  })
  describe('authenticate', function () {
    it('Should return true if data has not been altered', async function () {
      const { authentichain, metadata, metaHash, dataHash, owner } =
        await loadFixture(deployFixture)
      await authentichain.saveHash(metadata, 'data')

      expect(await authentichain.authenticate(metadata, 'data')).to.true
    })

    it('Should return false if data has been altered', async function () {
      const { authentichain, metadata, metaHash, dataHash, alteredDataHash } =
        await loadFixture(deployFixture)
      await authentichain.saveHash(metadata, 'data')

      expect(await authentichain.authenticate(metadata, 'date')).to.false
    })
  })
  describe('getters', function () {
    it('Should get the correct metadata given a metadata hash', async function () {
      const { authentichain, metadata, metaHash, dataHash } = await loadFixture(
        deployFixture
      )
      await authentichain.saveHash(metadata, 'data')
      const response = await authentichain.getMetaData(metaHash)
      const valueArray = Object.values(metadata)

      expect(response[0]).to.equal(valueArray[0])
      expect(response[1]).to.equal(valueArray[1])
      expect(response[2]).to.equal(valueArray[2])
      expect(response[3]).to.equal(valueArray[3])
      expect(response[4]).to.equal(valueArray[4])
      expect(response[5]).to.equal(valueArray[5])
      expect(response[6]).to.equal(valueArray[6])
    })

    it('Should get the correct data hash given a meta data hash', async function () {
      const { authentichain, metadata, metaHash, dataHash } = await loadFixture(
        deployFixture
      )
      await authentichain.saveHash(metadata, 'data')

      expect(await authentichain.getDataHash(metadata)).to.equal(dataHash)
    })
  })
})
