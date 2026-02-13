// Contract addresses — update after deployment
export const CONTRACT_ADDRESSES = {
  driverRegistry: '0x0000000000000000000000000000000000000000' as `0x${string}`,
  parkingNFT: '0x0000000000000000000000000000000000000000' as `0x${string}`,
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

export const PARKING_NFT_ABI = [
  {
    type: 'function',
    name: 'startSession',
    inputs: [
      { name: 'plateNumber', type: 'string' },
      { name: 'lotId', type: 'string' },
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'endSession',
    inputs: [
      { name: 'plateNumber', type: 'string' },
      { name: 'feePaid', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getActiveSession',
    inputs: [{ name: 'plateNumber', type: 'string' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'plateNumber', type: 'string' },
          { name: 'lotId', type: 'string' },
          { name: 'entryTime', type: 'uint256' },
          { name: 'exitTime', type: 'uint256' },
          { name: 'feePaid', type: 'uint256' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isParked',
    inputs: [{ name: 'plateNumber', type: 'string' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'SessionStarted',
    inputs: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'plateNumber', type: 'string', indexed: false },
      { name: 'lotId', type: 'string', indexed: false },
      { name: 'entryTime', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'SessionEnded',
    inputs: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'plateNumber', type: 'string', indexed: false },
      { name: 'exitTime', type: 'uint256', indexed: false },
      { name: 'fee', type: 'uint256', indexed: false },
    ],
  },
] as const
