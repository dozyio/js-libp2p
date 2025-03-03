# @libp2p/protocol-middleware

[![libp2p.io](https://img.shields.io/badge/project-libp2p-yellow.svg?style=flat-square)](http://libp2p.io/)
[![Discuss](https://img.shields.io/discourse/https/discuss.libp2p.io/posts.svg?style=flat-square)](https://discuss.libp2p.io)
[![codecov](https://img.shields.io/codecov/c/github/libp2p/js-libp2p.svg?style=flat-square)](https://codecov.io/gh/libp2p/js-libp2p)
[![CI](https://img.shields.io/github/actions/workflow/status/libp2p/js-libp2p/main.yml?branch=main\&style=flat-square)](https://github.com/libp2p/js-libp2p/actions/workflows/main.yml?query=branch%3Amain)

> Protocol middleware for libp2p to protect services with authentication

## Description

This module implements a protocol middleware service for libp2p. It allows you to protect specific services/protocols so they can only be accessed by authenticated connections. The middleware handles authentication transparently, so the protected services don't need to implement any authentication logic themselves.

The middleware is designed to work with different authentication providers, which are implemented in separate packages. This allows you to choose the authentication method that best suits your needs.

## Example

```js
import { createLibp2p } from 'libp2p'
import { createProtocolMiddleware } from '@libp2p/protocol-middleware'
import { challengeResponseProvider } from '@libp2p/middleware-auth-challenge'
import { ping } from '@libp2p/ping'
import { identify } from '@libp2p/identify'

const node = await createLibp2p({
  services: {
    ping: ping(),
    identify: identify(),
    // Initialize the protocol middleware
    protocolMiddleware: createProtocolMiddleware({
      // Select an authentication provider
      provider: challengeResponseProvider({
        timeout: 5000 // 5 second timeout
      }),
      // Services to protect
      protectedServices: {
        ping: ping(),
        identify: identify()
      }
    })
  }
})

// Connections are authenticated when accessing protected services
// But you can also authenticate manually
const connection = await node.dial('multiaddr')
const authenticated = await node.services.protocolMiddleware.authenticate(connection.id)

// Protect services dynamically
await node.services.protocolMiddleware.protectService('anotherService', anotherService)
```

## API

### Initialize

```js
import { createProtocolMiddleware } from '@libp2p/protocol-middleware'

const node = await createLibp2p({
  services: {
    protocolMiddleware: createProtocolMiddleware({
      // options
    })
  }
})
```

### Options

| Name             | Type              | Description                                             | Default      |
|------------------|-------------------|---------------------------------------------------------|--------------|
| provider         | `AuthProvider`    | Authentication provider to use                          | -            |
| autoAuthenticate | `boolean`         | Automatically try to authenticate unauthenticated connections | `true` |
| protectedServices| `Object`          | Services to protect with authentication                 | `{}`         |
| authOptions      | `Object`          | Per-service authentication options                      | `{}`         |

### API Methods

#### `authenticate(connectionId, options)`

- `connectionId` - The ID of the connection to authenticate
- `options` - Additional options (supports AbortSignal)
- Returns: `Promise<boolean>` - True if authentication successful, false otherwise

#### `isAuthenticated(connectionId)`

- `connectionId` - The ID of the connection to check
- Returns: `boolean` - True if the connection is authenticated

#### `protectService(name, service, authOptions)`

- `name` - Name of the service to protect
- `service` - The service object to protect
- `authOptions` - Optional authentication options
- Returns: `Promise<void>`

#### `unprotectService(name)`

- `name` - Name of the service to unprotect
- Returns: `Promise<void>`

## Auth Provider Interface

To create a custom authentication provider, implement the `AuthProvider` interface:

```typescript
interface AuthProvider extends Startable {
  readonly id: string;
  readonly name: string;
  authenticate(connectionId: string, options?: AbortOptions): Promise<boolean>;
  isAuthenticated(connectionId: string): boolean;
}
```

Available authentication providers:
- [@libp2p/middleware-auth-challenge](https://github.com/libp2p/js-libp2p/tree/main/packages/middleware-auth-challenge) - Challenge-response authentication

## Security Considerations

The protocol middleware provides an authentication layer beyond the standard libp2p encryption. This is useful for ensuring peers not only have valid encryption keys but have also passed additional authentication checks.

When protecting services, all access to those services will be blocked for unauthenticated connections.

## License

Licensed under either of

- Apache 2.0, ([LICENSE-APACHE](LICENSE-APACHE) / <http://www.apache.org/licenses/LICENSE-2.0>)
- MIT ([LICENSE-MIT](LICENSE-MIT) / <http://opensource.org/licenses/MIT>)