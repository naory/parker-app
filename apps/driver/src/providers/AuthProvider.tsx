'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import { SiweMessage } from 'siwe'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
const TOKEN_KEY = 'parker_auth_token'

interface AuthContextValue {
  /** JWT token for API calls (null if not signed in) */
  token: string | null
  /** Whether the SIWE sign-in flow is in progress */
  signing: boolean
  /** Trigger SIWE sign-in */
  signIn: () => Promise<void>
  /** Clear the session */
  signOut: () => void
  /** Whether the user is authenticated */
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextValue>({
  token: null,
  signing: false,
  signIn: async () => {},
  signOut: () => {},
  isAuthenticated: false,
})

export function useAuth() {
  return useContext(AuthContext)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { address, isConnected, chainId } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [token, setToken] = useState<string | null>(null)
  const [signing, setSigning] = useState(false)

  // Restore token from localStorage on mount
  useEffect(() => {
    if (!address) {
      setToken(null)
      return
    }
    const stored = localStorage.getItem(`${TOKEN_KEY}_${address}`)
    if (stored) setToken(stored)
  }, [address])

  // Clear token when wallet disconnects
  useEffect(() => {
    if (!isConnected) {
      setToken(null)
    }
  }, [isConnected])

  const signIn = useCallback(async () => {
    if (!address || !chainId) return
    setSigning(true)

    try {
      // 1. Fetch nonce from API
      const nonceRes = await fetch(`${API_URL}/api/auth/nonce`)
      const { nonce } = await nonceRes.json()

      // 2. Create SIWE message
      const message = new SiweMessage({
        domain: window.location.host,
        address,
        statement: 'Sign in to Parker — Smart Parking',
        uri: window.location.origin,
        version: '1',
        chainId,
        nonce,
      })

      const messageStr = message.prepareMessage()

      // 3. Sign with wallet
      const signature = await signMessageAsync({ message: messageStr })

      // 4. Verify on server and get JWT
      const verifyRes = await fetch(`${API_URL}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageStr, signature }),
      })

      if (!verifyRes.ok) {
        const err = await verifyRes.json().catch(() => ({}))
        throw new Error(err.error || 'Verification failed')
      }

      const { token: jwt } = await verifyRes.json()

      // 5. Store token
      localStorage.setItem(`${TOKEN_KEY}_${address}`, jwt)
      setToken(jwt)
    } catch (error: any) {
      console.error('SIWE sign-in failed:', error?.message || error)
      // If user rejected the signature, don't throw — just silently fail
    } finally {
      setSigning(false)
    }
  }, [address, chainId, signMessageAsync])

  const signOut = useCallback(() => {
    if (address) {
      localStorage.removeItem(`${TOKEN_KEY}_${address}`)
    }
    setToken(null)
  }, [address])

  return (
    <AuthContext.Provider
      value={{
        token,
        signing,
        signIn,
        signOut,
        isAuthenticated: !!token,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
