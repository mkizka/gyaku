<p align="center">
  <img src="https://raw.githubusercontent.com/mkizka/gyaku/main/packages/gyaku/icon.png" alt="@gyaku/di" width="120" />
</p>

# @gyaku/di

Gyaku (逆, "inversion") is a tiny, modern DI container for TypeScript, built around `await using`.

## Why gyaku?

- Type-safe registry chain
- No decorators, no `reflect-metadata`
- Sync and async factories under one API
- Unknown deps and duplicate keys caught at compile time
- Parallel resolution along the dependency graph
- Parallel, graph-aware disposal via `await using`
- Auto-cleanup of partially built services on failure
- `Symbol.asyncDispose` and `Symbol.dispose` both honored

## Install

Requires Node.js 24+.

```sh
npm install @gyaku/di
```

## Usage

```ts
import { createRegistry } from "@gyaku/di";

const createGreeter = ({ name }: { name: string }) => ({
  say: () => console.log(`hello, ${name}`),
});

const registry = createRegistry()
  .value("name", "gyaku")
  .service("greeter", ["name"], createGreeter);

await using services = await registry.resolve();
services.greeter.say();
// hello, gyaku
```

Runnable examples: [`examples/`](./examples).

## API

### `createRegistry()`

Returns an empty, immutable registry.

### `.value(key, instance)`

Registers a pre-built value, keeping its type as-is.

```ts
createRegistry().value("config", { port: 3000 });
```

### `.service(key, factory)` / `.service(key, deps, factory)`

Registers a sync or async factory that receives only the dependencies listed in `deps`.

```ts
const registry = createRegistry()
  .value("config", { port: 3000 })
  .service("logger", createLogger)
  .service("server", ["config", "logger"], createServer);
```

### `.replaceService(key, factory)`

Swaps a registered factory in place, keeping the original deps and return type.

```ts
const testRegistry = productionRegistry.replaceService("db", createStubDb);
```

### `.replaceValue(key, instance)`

Swaps a registered service with a pre-built instance, keeping the original return type.

```ts
const testRegistry = productionRegistry.replaceValue("db", stubDb);
```

### `resolve()`

Resolves the graph and returns `Promise<Services & AsyncDisposable>`; factories run in parallel, `await using` disposes in reverse along the graph, and any failure auto-disposes what was already created.

### `asClass(Class)` / `asClassArgs(Class)`

Adapts a class constructor into a factory, so classes register without a `(deps) => new Foo(...)` wrapper. `asClass` takes a single deps object and stays fully type-safe.

```ts
class Greeter {
  constructor(private deps: { logger: Logger }) {}
}

createRegistry()
  .service("logger", () => new Logger())
  .service("greeter", ["logger"], asClass(Greeter));
```

`asClassArgs` spreads deps into a positional constructor in `deps` order. Only the instance type is inferred, so `deps` must list the constructor's parameters in order.

```ts
class Greeter {
  constructor(logger: Logger, db: Db) {}
}

createRegistry().service("greeter", ["logger", "db"], asClassArgs(Greeter));
```

With `asClass<Interface>()(Class)`, the registered type is pinned to `Interface` instead of the concrete class, while `deps` is still inferred from the constructor.

This matters most for `.replaceService` / `.replaceValue`: a replacement must be assignable to the **originally registered type**. Pin a class to an interface and a test can swap in a stub that only has to satisfy that interface. Register the concrete class instead and the replacement would have to match the class down to its `#private` fields — usually impossible.

```ts
interface UserRepository {
  find(id: number): Promise<User | undefined>;
}

class UserRepositoryImpl implements UserRepository {
  constructor(private deps: { db: Db }) {}
  find(id: number) {
    return this.deps.db.findUser(id);
  }
}

const productionRegistry = createRegistry()
  .service("db", createDb)
  // userRepository is pinned to UserRepository, not UserRepositoryImpl
  .service(
    "userRepository",
    ["db"],
    asClass<UserRepository>()(UserRepositoryImpl),
  );

// the stub only has to satisfy UserRepository
const testRegistry = productionRegistry.replaceValue("userRepository", {
  find: async (id) => ({ id, name: "stub" }),
});
```

It works with `asClassArgs` too: `asClassArgs<UserRepository>()(UserRepositoryImpl)`.

### Errors

All errors extend `GyakuError`.

- `RegistryError` — invalid argument to `.service` / `.value` / `.replaceService` / `.replaceValue`.
- `ResolveError` — `.resolve()` failed. `errors` mixes `ServiceFactoryError` and `ServiceDisposeError`.
- `DisposeError` — `Symbol.asyncDispose` failed. `errors` is `ServiceDisposeError[]`.

Each inner error has `.key` (the service that failed) and `.cause` (the original throw).

```ts
import { ResolveError, ServiceFactoryError } from "@gyaku/di";

try {
  await using services = await registry.resolve();
} catch (error) {
  if (error instanceof ResolveError) {
    for (const e of error.errors) {
      console.error(e.key, e.cause);
    }
  }
}
```

### Notes

- Re-registering a key throws; use `.replaceService` / `.replaceValue` to replace.
- `then` is reserved (would make the services object look thenable).
- Services object has a null prototype, so keys like `__proto__` are safe.

## License

MIT
