// Contract addresses — update after deployment

// Base Sepolia: DriverRegistry (EVM)
export const CONTRACT_ADDRESSES = {
  driverRegistry: '0x0000000000000000000000000000000000000000' as `0x${string}`,
} as const

// Hedera: ParkingNFT collection via HTS (native token service)
// Set via HEDERA_TOKEN_ID env var; placeholder here for reference
export const HEDERA_CONFIG = {
  parkingNftTokenId: '0.0.0', // Update after running: pnpm --filter @parker/hedera setup
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

// Note: PARKING_NFT_ABI removed — parking NFTs are now managed via Hedera Token Service
// (native HTS, not EVM). See @parker/hedera package for NFT operations.
