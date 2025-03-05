/* eslint-env mocha */
import { expect } from 'aegir/chai'
import sinon from 'sinon'
import { createMiddlewareWrapper } from '../src/middleware-wrapper.js'
import type { } from '@libp2p/interface'
import type { } from '@libp2p/interface-internal'

describe('middleware-wrapper', () => {
  let mockAuthService: any
  let mockHandler: any
  let mockStream: any
  let mockConnection: any

  beforeEach(() => {
    // Setup mocks
    mockHandler = sinon.stub()

    mockAuthService = {
      wrap: sinon.stub().resolves(true),
      isWrapped: sinon.stub().returns(false),
      protectService: sinon.stub().resolves(),
      unprotectService: sinon.stub().resolves(),
      start: sinon.stub().resolves(),
      stop: sinon.stub().resolves(),
      isStarted: sinon.stub().returns(true),
      id: 'mock-auth',
      name: 'Mock Auth Service'
    }

    mockStream = {
      id: 'test-stream-id',
      abort: sinon.stub(),
      source: {
        [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: new Uint8Array() }) })
      },
      sink: async (source: any) => { /* empty */ },
      metadata: new Map()
    }

    mockConnection = {
      id: 'test-connection-id',
      remotePeer: {
        toString: () => 'test-peer-id'
      },
      remoteAddr: {
        toString: () => '/ip4/127.0.0.1/tcp/1234'
      },
      status: 'open',
      direction: 'outbound',
      timeline: { open: Date.now() },
      metadata: {},
      tags: new Map(),
      streams: [],
      newStream: sinon.stub().resolves(mockStream),
      close: sinon.stub().resolves(),
      getStreams: () => [],
      getTag: () => undefined,
      addTag: () => {},
      removeTag: () => {}
    }
  })

  afterEach(() => {
    sinon.restore()
  })

  describe('createMiddlewareWrapper', () => {
    it('should create a middleware wrapper function', () => {
      const wrapper = createMiddlewareWrapper(mockAuthService, mockHandler)

      expect(wrapper).to.be.a('function')
    })

    it('should call handler directly if connection is authenticated', () => {
      // Setup connection as authenticated
      mockAuthService.isWrapped.returns(true)

      const wrapper = createMiddlewareWrapper(mockAuthService, mockHandler)
      const data = { connection: mockConnection, stream: mockStream }

      // Call the wrapper
      wrapper(data)

      // Verify the handler was called directly
      expect(mockHandler.callCount).to.equal(1)
      expect(mockHandler.firstCall.args[0]).to.equal(data)
      expect(mockAuthService.wrap.callCount).to.equal(0)
      expect(mockStream.abort.callCount).to.equal(0)
    })

    // it('should abort the stream if connection is not authenticated and autoAuthenticate is false', () => {
    //   // Setup connection as not authenticated
    //   mockAuthService.isAuthenticated.returns(false)
    //
    //   const wrapper = createMiddlewareWrapper(mockAuthService, mockHandler, { autoAuthenticate: false })
    //   const data = { connection: mockConnection, stream: mockStream }
    //
    //   // Call the wrapper
    //   wrapper(data)
    //
    //   // Verify the stream was aborted and handler not called
    //   expect(mockStream.abort.callCount).to.equal(1)
    //   expect(mockHandler.callCount).to.equal(0)
    //   expect(mockAuthService.authenticate.callCount).to.equal(0)
    // })

    it('should initiate authentication if connection is not authenticated', async () => {
      // Setup connection as not authenticated initially but authentication will succeed
      mockAuthService.isWrapped.returns(false)
      mockAuthService.wrap.resolves(true)

      const wrapper = createMiddlewareWrapper(mockAuthService, mockHandler)
      const data = { connection: mockConnection, stream: mockStream }

      // Call the wrapper
      wrapper(data)

      // Verify authentication was attempted
      expect(mockAuthService.wrap.callCount).to.equal(1)
      expect(mockAuthService.wrap.firstCall.args[0]).to.equal(mockConnection.id)

      // Since authentication happens asynchronously, we need to wait for it
      return new Promise<void>(resolve => {
        setTimeout(() => {
          // Handler should be called after successful authentication
          expect(mockHandler.callCount).to.equal(1)
          expect(mockHandler.firstCall.args[0]).to.equal(data)
          expect(mockStream.abort.callCount).to.equal(0)
          resolve()
        }, 10)
      })
    })

    it('should abort the stream if authentication fails', async () => {
      // Setup connection as not authenticated and authentication will fail
      mockAuthService.isWrapped.returns(false)
      mockAuthService.wrap.resolves(false)

      const wrapper = createMiddlewareWrapper(mockAuthService, mockHandler)
      const data = { connection: mockConnection, stream: mockStream }

      // Call the wrapper
      wrapper(data)

      // Verify authentication was attempted
      expect(mockAuthService.wrap.callCount).to.equal(1)

      // Since authentication happens asynchronously, we need to wait for it
      return new Promise<void>(resolve => {
        setTimeout(() => {
          // Stream should be aborted after failed authentication
          expect(mockStream.abort.callCount).to.equal(1)
          expect(mockHandler.callCount).to.equal(0)
          resolve()
        }, 10)
      })
    })

    it('should abort the stream if authentication throws', async () => {
      // Setup authentication to throw an error
      mockAuthService.isWrapped.returns(false)
      mockAuthService.wrap.rejects(new Error('Authentication error'))

      const wrapper = createMiddlewareWrapper(mockAuthService, mockHandler)
      const data = { connection: mockConnection, stream: mockStream }

      // Call the wrapper
      wrapper(data)

      // Since authentication happens asynchronously, we need to wait for it
      return new Promise<void>(resolve => {
        setTimeout(() => {
          // Stream should be aborted after authentication error
          expect(mockStream.abort.callCount).to.equal(1)
          expect(mockHandler.callCount).to.equal(0)
          resolve()
        }, 10)
      })
    })

    describe('with authorization', () => {
      it('should call authorize function if connection is authenticated', async () => {
        // Setup connection as authenticated
        mockAuthService.isWrapped.returns(true)

        // Create authorize function
        const authorize = sinon.stub().resolves(true)

        const wrapper = createMiddlewareWrapper(mockAuthService, mockHandler, { authorize })
        const data = { connection: mockConnection, stream: mockStream }

        // Call the wrapper
        wrapper(data)

        // Verify authorize was called
        expect(authorize.callCount).to.equal(1)
        expect(authorize.firstCall.args[0]).to.equal(mockConnection)

        // Since authorization happens asynchronously, we need to wait for it
        return new Promise<void>(resolve => {
          setTimeout(() => {
            // Handler should be called after successful authorization
            expect(mockHandler.callCount).to.equal(1)
            expect(mockHandler.firstCall.args[0]).to.equal(data)
            expect(mockStream.abort.callCount).to.equal(0)
            resolve()
          }, 10)
        })
      })

      it('should abort the stream if authorization fails', async () => {
        // Setup connection as authenticated but authorization will fail
        mockAuthService.isWrapped.returns(true)
        const authorize = sinon.stub().resolves(false)

        const wrapper = createMiddlewareWrapper(mockAuthService, mockHandler, { authorize })
        const data = { connection: mockConnection, stream: mockStream }

        // Call the wrapper
        wrapper(data)

        // Since authorization happens asynchronously, we need to wait for it
        return new Promise<void>(resolve => {
          setTimeout(() => {
            // Stream should be aborted after failed authorization
            expect(mockStream.abort.callCount).to.equal(1)
            expect(mockHandler.callCount).to.equal(0)
            resolve()
          }, 10)
        })
      })

      it('should abort the stream if authorization throws', async () => {
        // Setup connection as authenticated but authorization will throw
        mockAuthService.isWrapped.returns(true)
        const authorize = sinon.stub().rejects(new Error('Authorization error'))

        const wrapper = createMiddlewareWrapper(mockAuthService, mockHandler, { authorize })
        const data = { connection: mockConnection, stream: mockStream }

        // Call the wrapper
        wrapper(data)

        // Since authorization happens asynchronously, we need to wait for it
        return new Promise<void>(resolve => {
          setTimeout(() => {
            // Stream should be aborted after authorization error
            expect(mockStream.abort.callCount).to.equal(1)
            expect(mockStream.abort.firstCall.args[0].message).to.include('Authorization error')
            expect(mockHandler.callCount).to.equal(0)
            resolve()
          }, 10)
        })
      })

      it('should run authentication then authorization when both are needed', async () => {
        // Setup connection as not authenticated
        mockAuthService.isWrapped.returns(false)
        mockAuthService.wrap.resolves(true)

        // Create authorize function
        const authorize = sinon.stub().resolves(true)

        const wrapper = createMiddlewareWrapper(mockAuthService, mockHandler, {
          authorize
        })
        const data = { connection: mockConnection, stream: mockStream }

        // Call the wrapper
        wrapper(data)

        // Since authentication and authorization happen asynchronously, we need to wait
        return new Promise<void>(resolve => {
          setTimeout(() => {
            // Authentication should be attempted
            expect(mockAuthService.wrap.callCount).to.equal(1)

            // Authorization should be called after successful authentication
            expect(authorize.callCount).to.equal(1)

            // Handler should be called after successful authentication and authorization
            expect(mockHandler.callCount).to.equal(1)
            expect(mockHandler.firstCall.args[0]).to.equal(data)
            expect(mockStream.abort.callCount).to.equal(0)
            resolve()
          }, 10)
        })
      })
    })
  })
})
