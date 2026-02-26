/**
 * Stub for @react-native-async-storage/async-storage when used by transitive deps (e.g. MetaMask SDK)
 * in a web-only Next.js app. Not used at runtime for our wallet flow.
 */
const noop = async () => {}
const stub = {
  getItem: noop,
  setItem: noop,
  removeItem: noop,
  getAllKeys: async () => [] as string[],
  clear: noop,
  multiGet: async () => [] as [string, string | null][],
  multiSet: noop,
  multiRemove: noop,
}
export default stub
