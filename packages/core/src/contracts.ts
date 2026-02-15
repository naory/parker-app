// Contract addresses — update after deployment

// Base Sepolia: DriverRegistry (EVM)
export const CONTRACT_ADDRESSES = {
  driverRegistry: '0x3Af58082dac96034a3D23cf9370b8763FEff62Ab' as `0x${string}`,
} as const

// Hedera: ParkingNFT collection via HTS (native token service)
// Set via HEDERA_TOKEN_ID env var; placeholder here for reference
export const HEDERA_CONFIG = {
  parkingNftTokenId: '0.0.7933460',
} as const

// ABIs will be imported from typechain-types after contract compilation.
// For now, define minimal ABIs for the functions we use from the frontend.

export const DRIVER_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'register',
    inputs: [
      { name: 'plateNumber', type: 'string' },
      { name: 'countryCode', type: 'string' },
      { name: 'carMake', type: 'string' },
      { name: 'carModel', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'isRegistered',
    inputs: [{ name: 'plateNumber', type: 'string' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getDriver',
    inputs: [{ name: 'plateNumber', type: 'string' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'wallet', type: 'address' },
          { name: 'plateNumber', type: 'string' },
          { name: 'countryCode', type: 'string' },
          { name: 'carMake', type: 'string' },
          { name: 'carModel', type: 'string' },
          { name: 'active', type: 'bool' },
          { name: 'registeredAt', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'deactivate',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'DriverRegistered',
    inputs: [
      { name: 'wallet', type: 'address', indexed: true },
      { name: 'plateNumber', type: 'string', indexed: false },
    ],
  },
] as const

// USDC contract addresses by network (used for EIP-681 QR codes and payment verification)
export const USDC_ADDRESSES: Record<string, `0x${string}`> = {
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
}

// Note: PARKING_NFT_ABI removed — parking NFTs are now managed via Hedera Token Service
// (native HTS, not EVM). See @parker/hedera package for NFT operations.
