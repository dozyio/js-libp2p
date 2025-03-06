/* eslint-env mocha */

import { expect } from 'aegir/chai'
import sinon from 'sinon'
import { middlewareRegistrar, type RegistrarComponents } from '../src/index.js'
import { mockLogger } from './utils/mock-logger.js'
import { mockMiddleware } from './utils/mock-middleware.js'
import { mockRegistrar } from './utils/mock-registrar.js'

describe('Middleware Registrar', () => {
  let components: RegistrarComponents
  let registrar: ReturnType<typeof mockRegistrar>
  let middleware: ReturnType<typeof mockMiddleware>
  const logger = mockLogger()

  beforeEach(() => {
    registrar = mockRegistrar()
    middleware = mockMiddleware()
    components = {
      registrar,
      logger
    } as unknown as RegistrarComponents
  })

  afterEach(() => {
    sinon.restore()
  })

  it('should create a middleware registry with default options', () => {
    const registry = middlewareRegistrar(components, middleware)

    expect(registry).to.exist()
    expect((registry as any)[Symbol.toStringTag]).to.equal('@libp2p/middleware-registry')
  })

  it('should create a registry with protocol-specific options', () => {
    const defaultOptions = { required: false }
    const protocolOptions = {
      '/test/1.0.0': { required: true },
      '/test/2.0.0': { timeout: 1000 }
    }

    const registry = middlewareRegistrar(components, middleware, {
      defaultOptions,
      protocolOptions
    })

    expect(registry).to.exist()
    expect((registry as any)[Symbol.toStringTag]).to.equal('@libp2p/middleware-registry')
  })
})
