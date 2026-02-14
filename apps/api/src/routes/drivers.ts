import { Router } from 'express'
import type { RegisterDriverRequest } from '@parker/core'
import { normalizePlate } from '@parker/core'

import { db } from '../db'

export const driversRouter = Router()

// POST /api/drivers/register — Register new driver + vehicle
driversRouter.post('/register', async (req, res) => {
  try {
    const { plateNumber, countryCode, carMake, carModel } = req.body as RegisterDriverRequest

    // TODO: Verify wallet signature from request headers
    const wallet = req.headers['x-wallet-address'] as string
    if (!wallet) {
      return res.status(400).json({ error: 'Wallet address required' })
    }

    // Validate required fields
    if (!plateNumber || !countryCode) {
      return res.status(400).json({ error: 'plateNumber and countryCode are required' })
    }

    const driver = await db.createDriver({
      wallet,
      plateNumber: normalizePlate(plateNumber),
      countryCode,
      carMake,
      carModel,
    })

    res.status(201).json(driver)
  } catch (error: any) {
    console.error('Failed to register driver:', error)
    // Handle unique constraint violation (duplicate plate)
    if (error?.code === '23505') {
      return res.status(409).json({ error: 'Plate number already registered' })
    }
    res.status(500).json({ error: 'Failed to register driver' })
  }
})

// GET /api/drivers/wallet/:address — Get driver by wallet address
driversRouter.get('/wallet/:address', async (req, res) => {
  try {
    const driver = await db.getDriverByWallet(req.params.address)
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found for this wallet' })
    }
    res.json(driver)
  } catch (error) {
    console.error('Failed to get driver by wallet:', error)
    res.status(500).json({ error: 'Failed to get driver' })
  }
})

// GET /api/drivers/:plate — Get driver profile
driversRouter.get('/:plate', async (req, res) => {
  try {
    const driver = await db.getDriverByPlate(normalizePlate(req.params.plate))
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' })
    }
    res.json(driver)
  } catch (error) {
    console.error('Failed to get driver:', error)
    res.status(500).json({ error: 'Failed to get driver' })
  }
})

// PUT /api/drivers/:plate — Update profile
driversRouter.put('/:plate', async (req, res) => {
  try {
    const driver = await db.updateDriver(normalizePlate(req.params.plate), req.body)
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' })
    }
    res.json(driver)
  } catch (error) {
    console.error('Failed to update driver:', error)
    res.status(500).json({ error: 'Failed to update driver' })
  }
})

// DELETE /api/drivers/:plate — Deactivate driver
driversRouter.delete('/:plate', async (req, res) => {
  try {
    const deactivated = await db.deactivateDriver(normalizePlate(req.params.plate))
    if (!deactivated) {
      return res.status(404).json({ error: 'Driver not found' })
    }
    res.json({ success: true })
  } catch (error) {
    console.error('Failed to deactivate driver:', error)
    res.status(500).json({ error: 'Failed to deactivate driver' })
  }
})
