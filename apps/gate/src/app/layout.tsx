import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'

import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Parker Gate - Operator',
  description: 'Parking lot gate operator interface',
  manifest: '/manifest.json',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#064f85',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="flex min-h-screen">
          {/* Sidebar nav */}
          <nav className="w-16 bg-parker-900 text-white lg:w-56">
            <div className="p-4">
              <h1 className="hidden text-lg lg:block">
                <span className="font-bold text-white">Parker</span>{' '}
                <span className="font-light text-parker-300">Gate</span>
              </h1>
              {process.env.NEXT_PUBLIC_LOT_ID && (
                <p className="hidden text-xs text-gray-400 lg:block">{process.env.NEXT_PUBLIC_LOT_ID}</p>
              )}
              <p className="text-center text-2xl font-bold lg:hidden">P</p>
            </div>
            <ul className="mt-4 space-y-1">
              <NavItem href="/" label="Gate" icon="G" />
              <NavItem href="/sessions" label="Sessions" icon="S" />
              <NavItem href="/dashboard" label="Dashboard" icon="D" />
              <NavItem href="/settings" label="Settings" icon="=" />
            </ul>
          </nav>

          {/* Main content */}
          <main className="flex-1 bg-gray-50">{children}</main>
        </div>
      </body>
    </html>
  )
}

function NavItem({ href, label, icon }: { href: string; label: string; icon: string }) {
  return (
    <li>
      <a
        href={href}
        className="flex items-center gap-3 px-4 py-3 text-sm text-gray-300 transition hover:bg-parker-800 hover:text-white"
      >
        <span className="text-lg">{icon}</span>
        <span className="hidden lg:inline">{label}</span>
      </a>
    </li>
  )
}
