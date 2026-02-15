import rateLimit from 'express-rate-limit'

const isTest = process.env.NODE_ENV === 'test'

/** 10 requests per minute — for auth endpoints */
export const strictLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTest,
})

/** 30 requests per minute — for gate operations and registration */
export const mediumLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTest,
})

/** 100 requests per minute — catch-all for other API routes */
export const standardLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTest,
})
