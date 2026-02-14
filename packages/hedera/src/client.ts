import {
  Client,
  AccountId,
  PrivateKey,
} from '@hashgraph/sdk'

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

  client.setOperator(
    AccountId.fromString(accountId),
    PrivateKey.fromStringDer(privateKey),
  )

  return client
}
