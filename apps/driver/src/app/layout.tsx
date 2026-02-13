import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'

import { WalletProvider } from '@/providers/WalletProvider'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Parker - Smart Parking',
  description: 'Decentralized parking management powered by blockchain',
  manifest: '/manifest.json',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0c93e9',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <WalletProvider>
          <main className="min-h-screen bg-gray-50">{children}</main>
        </WalletProvider>
      </body>
    </html>
  )
}
