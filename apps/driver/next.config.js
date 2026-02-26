const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@parker/core'],
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    // Stub React Native async-storage for web (pulled in by wagmi/connectors; we use Coinbase only)
    const stubPath = path.resolve(__dirname, 'src/lib/async-storage-stub.ts')
    config.resolve.alias['@react-native-async-storage/async-storage'] = stubPath
    config.resolve.alias['@react-native-async-storage/async-storage$'] = stubPath
    return config
  },
}

module.exports = nextConfig
