/* eslint-env mocha */
import { expect } from 'aegir/chai'
import type { AuthenticationProvider } from '../src/authentication-provider.js'
import type { AbortOptions } from '@libp2p/interface'

describe('AuthenticationProvider Interface', () => {
  it('should define the interface properties required for authentication providers', () => {
    // This test merely validates that the TypeScript interface exists
    // and has the expected methods
    
    // Since we're just testing the interface, we can cast to it
    const provider: AuthenticationProvider = {
      // Required properties
      id: 'test-provider',
      name: 'Test Provider',
      
      // Methods that must be implemented
      start: async (): Promise<void> => {},
      stop: async (): Promise<void> => {},
      authenticate: async (connectionId: string, options?: AbortOptions): Promise<boolean> => true,
      isAuthenticated: (connectionId: string): boolean => true
    } as AuthenticationProvider
    
    expect(provider).to.exist()
    expect(provider.id).to.equal('test-provider')
    expect(provider.name).to.equal('Test Provider')
    expect(provider.start).to.be.a('function')
    expect(provider.stop).to.be.a('function')
    expect(provider.authenticate).to.be.a('function')
    expect(provider.isAuthenticated).to.be.a('function')
  })
})