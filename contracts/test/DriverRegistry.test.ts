import { expect } from 'chai'
import { ethers } from 'hardhat'
import { DriverRegistry } from '../typechain-types'

describe('DriverRegistry', () => {
  let registry: DriverRegistry
  let owner: Awaited<ReturnType<typeof ethers.getSigners>>[0]
  let driver1: Awaited<ReturnType<typeof ethers.getSigners>>[0]
  let driver2: Awaited<ReturnType<typeof ethers.getSigners>>[0]

  beforeEach(async () => {
    ;[owner, driver1, driver2] = await ethers.getSigners()
    const Factory = await ethers.getContractFactory('DriverRegistry')
    registry = await Factory.deploy()
  })

  describe('register', () => {
    it('should register a new driver', async () => {
      await expect(registry.connect(driver1).register('12-345-67', 'IL', 'Toyota', 'Corolla'))
        .to.emit(registry, 'DriverRegistered')
        .withArgs(driver1.address, '12-345-67')

      const profile = await registry.getDriver('12-345-67')
      expect(profile.wallet).to.equal(driver1.address)
      expect(profile.plateNumber).to.equal('12-345-67')
      expect(profile.countryCode).to.equal('IL')
      expect(profile.carMake).to.equal('Toyota')
      expect(profile.carModel).to.equal('Corolla')
      expect(profile.active).to.be.true
    })

    it('should reject duplicate plate registration', async () => {
      await registry.connect(driver1).register('12-345-67', 'IL', 'Toyota', 'Corolla')
      await expect(
        registry.connect(driver2).register('12-345-67', 'IL', 'Honda', 'Civic'),
      ).to.be.revertedWithCustomError(registry, 'AlreadyRegistered')
    })

    it('should reject wallet registering twice', async () => {
      await registry.connect(driver1).register('12-345-67', 'IL', 'Toyota', 'Corolla')
      await expect(
        registry.connect(driver1).register('99-999-99', 'IL', 'Honda', 'Civic'),
      ).to.be.revertedWithCustomError(registry, 'AlreadyRegistered')
    })
  })

  describe('isRegistered', () => {
    it('should return true for registered plate', async () => {
      await registry.connect(driver1).register('12-345-67', 'IL', 'Toyota', 'Corolla')
      expect(await registry.isRegistered('12-345-67')).to.be.true
    })

    it('should return false for unknown plate', async () => {
      expect(await registry.isRegistered('99-999-99')).to.be.false
    })
  })

  describe('deactivate', () => {
    it('should deactivate a registered driver', async () => {
      await registry.connect(driver1).register('12-345-67', 'IL', 'Toyota', 'Corolla')
      await expect(registry.connect(driver1).deactivate())
        .to.emit(registry, 'DriverDeactivated')
        .withArgs(driver1.address, '12-345-67')

      expect(await registry.isRegistered('12-345-67')).to.be.false
    })

    it('should reject deactivation from unregistered wallet', async () => {
      await expect(registry.connect(driver2).deactivate()).to.be.revertedWithCustomError(
        registry,
        'NotRegistered',
      )
    })
  })

  describe('updateProfile', () => {
    it('should update car details', async () => {
      await registry.connect(driver1).register('12-345-67', 'IL', 'Toyota', 'Corolla')
      await registry.connect(driver1).updateProfile('Honda', 'Civic')

      const profile = await registry.getDriver('12-345-67')
      expect(profile.carMake).to.equal('Honda')
      expect(profile.carModel).to.equal('Civic')
    })
  })
})
