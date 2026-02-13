import { ethers } from 'hardhat'

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log('Deploying contracts with account:', deployer.address)

  // Deploy DriverRegistry
  const DriverRegistry = await ethers.getContractFactory('DriverRegistry')
  const driverRegistry = await DriverRegistry.deploy()
  await driverRegistry.waitForDeployment()
  const driverRegistryAddress = await driverRegistry.getAddress()
  console.log('DriverRegistry deployed to:', driverRegistryAddress)

  // Deploy ParkingNFT
  const ParkingNFT = await ethers.getContractFactory('ParkingNFT')
  const parkingNFT = await ParkingNFT.deploy()
  await parkingNFT.waitForDeployment()
  const parkingNFTAddress = await parkingNFT.getAddress()
  console.log('ParkingNFT deployed to:', parkingNFTAddress)

  console.log('\n--- Deployment Summary ---')
  console.log(`DRIVER_REGISTRY_ADDRESS=${driverRegistryAddress}`)
  console.log(`PARKING_NFT_ADDRESS=${parkingNFTAddress}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
