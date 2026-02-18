import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ParkingNFT } from '../typechain-types'

describe('ParkingNFT', () => {
  let nft: ParkingNFT
  let owner: Awaited<ReturnType<typeof ethers.getSigners>>[0]
  let lotOperator: Awaited<ReturnType<typeof ethers.getSigners>>[0]
  let unauthorized: Awaited<ReturnType<typeof ethers.getSigners>>[0]

  beforeEach(async () => {
    ;[owner, lotOperator, unauthorized] = await ethers.getSigners()
    const Factory = await ethers.getContractFactory('ParkingNFT')
    nft = await Factory.deploy()

    // Authorize the lot operator
    await nft.authorizeLot(lotOperator.address)
  })

  describe('authorization', () => {
    it('should authorize a lot operator', async () => {
      expect(await nft.authorizedLots(lotOperator.address)).to.be.true
    })

    it('should revoke a lot operator', async () => {
      await nft.revokeLot(lotOperator.address)
      expect(await nft.authorizedLots(lotOperator.address)).to.be.false
    })

    it('should reject non-owner authorization', async () => {
      await expect(
        nft.connect(unauthorized).authorizeLot(unauthorized.address),
      ).to.be.revertedWithCustomError(nft, 'OwnableUnauthorizedAccount')
    })
  })

  describe('startSession', () => {
    it('should start a parking session and mint NFT', async () => {
      await expect(nft.connect(lotOperator).startSession('12-345-67', 'LOT-001'))
        .to.emit(nft, 'SessionStarted')
        .withArgs(1, '12-345-67', 'LOT-001', (v: bigint) => v > 0n)

      const session = await nft.getSession(1)
      expect(session.plateNumber).to.equal('12-345-67')
      expect(session.lotId).to.equal('LOT-001')
      expect(session.active).to.be.true
      expect(session.exitTime).to.equal(0n)
    })

    it('should reject unauthorized lot', async () => {
      await expect(
        nft.connect(unauthorized).startSession('12-345-67', 'LOT-001'),
      ).to.be.revertedWithCustomError(nft, 'NotAuthorizedLot')
    })

    it('should reject duplicate active session for same plate', async () => {
      await nft.connect(lotOperator).startSession('12-345-67', 'LOT-001')
      await expect(
        nft.connect(lotOperator).startSession('12-345-67', 'LOT-002'),
      ).to.be.revertedWithCustomError(nft, 'AlreadyParked')
    })
  })

  describe('endSession', () => {
    beforeEach(async () => {
      await nft.connect(lotOperator).startSession('12-345-67', 'LOT-001')
    })

    it('should end a parking session', async () => {
      const fee = ethers.parseUnits('7.43', 6) // 7.43 USDC

      await expect(nft.connect(lotOperator).endSession('12-345-67', fee))
        .to.emit(nft, 'SessionEnded')
        .withArgs(1, '12-345-67', (v: bigint) => v > 0n, fee)

      const session = await nft.getSession(1)
      expect(session.active).to.be.false
      expect(session.exitTime).to.be.gt(0n)
      expect(session.feePaid).to.equal(fee)
    })

    it('should reject ending non-existent session', async () => {
      await expect(
        nft.connect(lotOperator).endSession('99-999-99', 0),
      ).to.be.revertedWithCustomError(nft, 'NoActiveSession')
    })

    it('should allow new session after ending previous', async () => {
      await nft.connect(lotOperator).endSession('12-345-67', 0)
      await expect(nft.connect(lotOperator).startSession('12-345-67', 'LOT-001')).to.not.be.reverted
    })
  })

  describe('isParked', () => {
    it('should return true for active session', async () => {
      await nft.connect(lotOperator).startSession('12-345-67', 'LOT-001')
      expect(await nft.isParked('12-345-67')).to.be.true
    })

    it('should return false after session ends', async () => {
      await nft.connect(lotOperator).startSession('12-345-67', 'LOT-001')
      await nft.connect(lotOperator).endSession('12-345-67', 0)
      expect(await nft.isParked('12-345-67')).to.be.false
    })
  })
})
