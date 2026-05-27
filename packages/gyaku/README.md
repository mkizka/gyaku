<p align="center">
  <img src="https://raw.githubusercontent.com/mkizka/gyaku/main/packages/gyaku/icon.png" alt="@gyaku/di" width="120" />
</p>

# @gyaku/di

Gyaku (逆, "inversion") is a tiny, modern DI container for TypeScript, built around `await using`.

## Why @gyaku/di?

- Type-safe builder chain
- No decorators, no `reflect-metadata`
- Sync and async factories under one API
- Unknown deps and duplicate keys caught at compile time
- Parallel build along the dependency graph
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
import { createContainer } from "@gyaku/di";

const createGreeter = ({ name }: { name: string }) => ({
  say: () => console.log(`hello, ${name}`),
});

const container = createContainer()
  .value("name", "gyaku")
  .service("greeter", ["name"], createGreeter);

await using services = await container.build();
services.greeter.say();
// hello, gyaku
```

Runnable examples: [`examples/`](./examples).

## API

### `createContainer()`

Returns an empty, immutable builder.

### `.value(key, instance)`

Registers a pre-built value, keeping its type as-is.

```ts
createContainer().value("config", { port: 3000 });
```

### `.service(key, factory)` / `.service(key, deps, factory)`

Registers a sync or async factory that receives only the dependencies listed in `deps`.

```ts
const container = createContainer()
  .value("config", { port: 3000 })
  .service("logger", createLogger)
  .service("server", ["config", "logger"], createServer);
```

### `.override(key, factory)`

Swaps a registered factory in place, keeping the original deps and return type.

```ts
const testContainer = productionContainer.override("db", () => stubDb);
```

### `build()`

Resolves the graph and returns `Promise<Services & AsyncDisposable>`; factories run in parallel, `await using` disposes in reverse along the graph, and any failure auto-disposes what was built.

### Notes

- Re-registering a key throws; use `.override` to replace.
- `then` is reserved (would make the services object look thenable).
- Services object has a null prototype, so keys like `__proto__` are safe.

## License

MIT
