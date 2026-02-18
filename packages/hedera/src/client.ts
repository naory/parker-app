import { Client, AccountId, PrivateKey } from '@hashgraph/sdk'

export type HederaNetwork = 'testnet' | 'mainnet' | 'previewnet'

export interface HederaConfig {
  accountId: string
  privateKey: string
  network: HederaNetwork
}

/**
 * Create an authenticated Hedera client.
 * The returned client is used for all HTS operations.
 */
export function createHederaClient(config: HederaConfig): Client {
  const { accountId, privateKey, network } = config

  let client: Client
  switch (network) {
    case 'mainnet':
      client = Client.forMainnet()
      break
    case 'previewnet':
      client = Client.forPreviewnet()
      break
    case 'testnet':
    default:
      client = Client.forTestnet()
      break
  }

  // Auto-detect key format: DER (302e...) vs hex (0x... or raw hex)
  const key = privateKey.startsWith('302')
    ? PrivateKey.fromStringDer(privateKey)
    : PrivateKey.fromStringECDSA(privateKey.replace(/^0x/, ''))

  client.setOperator(AccountId.fromString(accountId), key)

  return client
}
