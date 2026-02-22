// Jest setup file
// Mock Next.js modules that aren't available in test environment

jest.mock('next/config', () => () => ({
  env: {},
}))

// Mock resend to avoid SSR issues
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: jest.fn().mockResolvedValue({ data: { id: 'test' } }),
    },
  })),
}))

// Mock environment variables
process.env.NODE_ENV = 'test'
process.env.MOBIPIUM_API_TOKEN = 'test_token'
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
