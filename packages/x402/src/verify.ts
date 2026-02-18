import { type PublicClient, decodeEventLog, parseAbi } from 'viem'
import type { PaymentTransferResult } from './adapter'

const erc20TransferAbi = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
])

export interface ERC20TransferResult extends PaymentTransferResult {}

/**
 * Verify an ERC20 transfer on-chain by checking the transaction receipt.
 * Decodes the Transfer event and returns sender, receiver, and amount.
 *
 * @param client - viem PublicClient
 * @param txHash - transaction hash (0x-prefixed)
 * @param expectedToken - optional token contract address to filter Transfer events
 */
export async function verifyERC20Transfer(
  client: PublicClient,
  txHash: `0x${string}`,
  expectedToken?: string,
): Promise<ERC20TransferResult> {
  const receipt = await client.getTransactionReceipt({ hash: txHash })

  if (receipt.status === 'reverted') {
    throw new Error('Transaction reverted')
  }

  // Find Transfer event in logs
  for (const log of receipt.logs) {
    // If expectedToken is set, only look at logs from that contract
    if (expectedToken && log.address.toLowerCase() !== expectedToken.toLowerCase()) {
      continue
    }

    try {
      const decoded = decodeEventLog({
        abi: erc20TransferAbi,
        data: log.data,
        topics: log.topics,
      })

      if (decoded.eventName === 'Transfer') {
        return {
          from: decoded.args.from,
          to: decoded.args.to,
          amount: decoded.args.value,
          confirmed: receipt.status === 'success',
        }
      }
    } catch {
      // Not a Transfer event — continue to next log
    }
  }

  throw new Error('No ERC20 Transfer event found in transaction')
}
