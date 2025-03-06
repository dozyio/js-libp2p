/* eslint-env mocha */
import { defaultLogger } from '@libp2p/logger'
import { expect } from 'aegir/chai'
import { lpStream } from 'it-length-prefixed-stream'
import { pushable } from 'it-pushable'
import sinon from 'sinon'
import { stubInterface, type StubbedInstance } from 'sinon-ts'
import { fromString } from 'uint8arrays/from-string'
import { TIMEOUT } from '../src/constants.js'
import { MiddlewareChallengeResponse } from '../src/middleware-challenge-response.js'
import type { ComponentLogger } from '@libp2p/interface'
import type { ConnectionManager, Registrar } from '@libp2p/interface-internal'

interface StubbedMiddlewareChallengeResponseComponents {
  registrar: StubbedInstance<Registrar>
  connectionManager: StubbedInstance<ConnectionManager>
  logger: ComponentLogger
}

describe('Challenge Response Middleware', () => {
  let components: StubbedMiddlewareChallengeResponseComponents

  let middleware: any
  let connectionId: string
  let mockConnection: any
  let mockStream: any

  beforeEach(() => {
    connectionId = 'test-connection-id'

    components = {
      registrar: stubInterface<Registrar>(),
      connectionManager: stubInterface<ConnectionManager>(),
      logger: defaultLogger()
    }
    // // Reset stubs
    // components.connectionManager.getConnections.reset()
    // components.registrar.handle.reset()
    // components.registrar.unhandle.reset()
    // components.registrar.getHandler.reset()

    // Create mock connection
    mockConnection = {
      id: connectionId,
      remotePeer: {
        toString: () => 'test-peer-id'
      },
      newStream: sinon.stub()
    }

    // Set up connection manager to return our mock connection
    components.connectionManager.getConnections.returns([mockConnection])

    // Create mock stream for authentication
    mockStream = {
      sink: sinon.stub().resolves(),
      source: [],
      close: sinon.stub().resolves()
    }

    // Set up connection to return our mock stream
    mockConnection.newStream.resolves(mockStream)

    // Create provider
    middleware = new MiddlewareChallengeResponse(components)
  })

  describe('Middleware factory', () => {
    it('should create a middleware with the correct interface', () => {
      expect(middleware[Symbol.toStringTag]).to.equal('@libp2p/middleware-challenge-response')
      expect(middleware.wrap).to.be.a('function')
      expect(middleware.isWrapped).to.be.a('function')
      expect(middleware.start).to.be.a('function')
      expect(middleware.stop).to.be.a('function')
      expect(middleware.isStarted).to.be.a('function')
    })

    it('should accept custom timeout option', () => {
      const customTimeout = TIMEOUT * 2
      const mw = new MiddlewareChallengeResponse(components, { timeout: customTimeout })
      expect(mw.timeout).to.equal(customTimeout)
    })

    it('should accept custom protocol prefix', () => {
      const mw = new MiddlewareChallengeResponse(components, { protocolPrefix: 'custom' })
      expect(mw.protocol).to.contain('custom')
    })
  })

  describe('Provider instance', () => {
    it('should create a valid provider instance', () => {
      expect(middleware).to.exist()
      expect(middleware.start).to.be.a('function')
      expect(middleware.stop).to.be.a('function')
      expect(middleware.isStarted).to.be.a('function')
      expect(middleware.wrap).to.be.a('function')
      expect(middleware.isWrapped).to.be.a('function')
    })

    it('should return false for isStarted initially', () => {
      expect(middleware.isStarted()).to.be.false()
    })

    it('should return false for isWrapped', async () => {
      expect(middleware.isWrapped(connectionId)).to.be.false()
    })

    it('should return false for wrap when not started', async () => {
      const result = await middleware.wrap(connectionId)
      expect(result).to.be.false()
    })

    describe('start and stop', () => {
      it('should register and unregister protocol handler', async () => {
        components.registrar.getHandler.throws('UnhandledProtocolError')
        await middleware.start()

        expect(components.registrar.handle.called, 'handle called').to.be.true()
        expect(middleware.isStarted(), 'isStarted true').to.be.true()

        components.registrar.getHandler.reset()
        await middleware.stop()

        expect(components.registrar.unhandle.called, 'unhandle called').to.be.true()
        expect(middleware.isStarted(), 'isStarted false').to.be.false()
      })
    })

    describe('wrap', () => {
      beforeEach(async () => {
        await middleware.start()
      })

      afterEach(async () => {
        await middleware.stop()
      })

      it('should open a stream to the remote peer for wrap', async () => {
        // Set up a simple successful response in the mock stream
        mockStream.source = {
          [Symbol.asyncIterator]: async function * () {
            yield fromString('valid-response', 'hex')
          }
        }

        // Start authentication process
        const authPromise = middleware.wrap(connectionId)

        // Wait for the promise to resolve
        await authPromise

        // Verify that newStream was called
        expect(mockConnection.newStream.called).to.be.true()
      })

      // Define a simple in‑memory duplex stream type.
      interface FakeDuplex {
        source: AsyncIterable<Uint8Array>
        sink(source: AsyncIterable<Uint8Array>): Promise<void>
        close?(): Promise<void>
        abort?(err: Error): void
      }

      // Create a pair of FakeDuplex endpoints.
      function createFakeDuplexPair (): { client: FakeDuplex, server: FakeDuplex } {
        // Create two pushable sources.
        const clientSource = pushable<Uint8Array>()
        const serverSource = pushable<Uint8Array>()

        // The client’s sink writes to the server’s source.
        const client: FakeDuplex = {
          // Client reads what the server writes.
          source: serverSource,
          sink: async (source: AsyncIterable<Uint8Array>) => {
            for await (const chunk of source) {
              clientSource.push(chunk)
            }
            clientSource.end()
          },
          close: async () => {
            clientSource.end()
          },
          abort: (err: Error) => {
            clientSource.end(err)
          }
        }

        // The server’s sink writes to the client’s source.
        const server: FakeDuplex = {
          // Server reads what the client writes.
          source: clientSource,
          sink: async (source: AsyncIterable<Uint8Array>) => {
            for await (const chunk of source) {
              serverSource.push(chunk)
            }
            serverSource.end()
          },
          close: async () => {
            serverSource.end()
          },
          abort: (err: Error) => {
            serverSource.end(err)
          }
        }

        return { client, server }
      }

      it('should send a challenge and wait for response using a fake duplex pair', async () => {
        // Create the fake duplex pair.
        const { client: clientStream, server: serverStream } = createFakeDuplexPair()

        // Polyfill a synchronous iterator on the source for libraries like lpStream.
        if (!(clientStream.source as any)[Symbol.iterator]) {
          (clientStream.source as any)[Symbol.iterator] = clientStream.source[Symbol.asyncIterator].bind(clientStream.source)
        }
        if (!(serverStream.source as any)[Symbol.iterator]) {
          (serverStream.source as any)[Symbol.iterator] = serverStream.source[Symbol.asyncIterator].bind(serverStream.source)
        }

        // Simulate the server behavior.
        async function simulateServer (): Promise<void> {
          const lpServer = lpStream(serverStream)
          const challenge = 'test-challenge'
          // Send the challenge.
          await lpServer.write(new TextEncoder().encode(challenge))
          // Read the client's response.
          const res = await lpServer.read({ signal: AbortSignal.timeout(1000) })
          if (!res) throw new Error('Server did not receive a response')
          const response = new TextDecoder().decode(res.slice())
          // Calculate the expected response using your middleware's helper.
          const expectedResponse = await middleware.calculateSha256(challenge)
          // Send back "OK" if correct, "NO" otherwise.
          if (response === expectedResponse) {
            await lpServer.write(new TextEncoder().encode('OK'))
          } else {
            await lpServer.write(new TextEncoder().encode('NO'))
          }
          if (serverStream.close) await serverStream.close()
        }

        // Run the simulated server concurrently.
        simulateServer().catch(err => { console.error('simulateServer error:', err) })

        // Create a fake connection that returns our client stream.
        const fakeConnection = {
          id: 'test-connection-id',
          remotePeer: { toString: () => 'test-peer-id' },
          newStream: async (_protocol: string, _options?: any) => clientStream
        }

        // Stub the connection manager to return our fake connection.
        middleware.components.connectionManager.getConnections = () => [fakeConnection]
        // Stub the client's close method.
        clientStream.close = sinon.stub().resolves()

        // Run the middleware's wrap process.
        const result: boolean = await middleware.wrap('test-connection-id')
        const expectedResponse: string = await middleware.calculateSha256('test-challenge')

        expect(result).to.equal(true)
        expect((clientStream.close as sinon.SinonStub).called).to.be.true()
      })

      it('should have a working isWrapped function', () => {
        // Initially, connection is not wrapped
        expect(middleware.isWrapped(connectionId)).to.be.false()
      })
    })
  })
})
