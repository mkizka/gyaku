import { describe, expectTypeOf, it } from "vitest";

import { createRegistry } from "../src/index.ts";

type Logger = { log: (message: string) => string };
type Db = { query: (sql: string) => string[] };
type Repo = { find: () => string[] };

describe("createRegistry", () => {
  it("starts with an empty service map", async () => {
    const services = await createRegistry().resolve();

    expectTypeOf(services).toEqualTypeOf<
      Record<never, never> & AsyncDisposable
    >();
  });
});

describe("ServiceRegistry.service", () => {
  it("accumulates services across chained registrations", async () => {
    const registry = createRegistry()
      .service("logger", (): Logger => ({ log: (message) => message }))
      .service("db", (): Promise<Db> =>
        Promise.resolve({ query: (sql: string) => [sql] }),
      )
      .service("repo", ["db"], ({ db }): Repo => ({
        find: () => db.query("select 1"),
      }));

    const services = await registry.resolve();

    expectTypeOf(services.logger).toEqualTypeOf<Logger>();
    expectTypeOf(services.db).toEqualTypeOf<Db>();
    expectTypeOf(services.repo).toEqualTypeOf<Repo>();
  });

  it("unwraps Promise return values via Awaited", () => {
    const registry = createRegistry().service("db", () =>
      Promise.resolve({ query: (sql: string) => [sql] }),
    );

    expectTypeOf(registry.resolve()).resolves.toExtend<{ db: Db }>();
  });

  it("passes only declared dependencies to the factory", () => {
    createRegistry()
      .service("logger", (): Logger => ({ log: (m) => m }))
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      .service("repo", ["db"], (deps) => {
        expectTypeOf(deps).toEqualTypeOf<{ db: Db }>();
        return { find: () => deps.db.query("select 1") };
      });
  });

  it("widens deps when more keys are declared", () => {
    createRegistry()
      .service("logger", (): Logger => ({ log: (m) => m }))
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      .service("repo", ["db", "logger"], (deps) => {
        expectTypeOf(deps).toEqualTypeOf<{ db: Db; logger: Logger }>();
        return { find: () => deps.db.query("select 1") };
      });
  });

  it("rejects dependencies that are not yet registered", () => {
    createRegistry()
      .service("logger", (): Logger => ({ log: (m) => m }))
      // @ts-expect-error "db" has not been registered.
      .service("repo", ["db"], () => undefined);
  });

  it("rejects duplicate service keys", () => {
    createRegistry()
      .service("logger", () => undefined)
      // @ts-expect-error "logger" already exists in the service map.
      .service("logger", () => undefined);
  });

  it('reserves the "then" key to avoid thenable collisions', () => {
    // @ts-expect-error "then" is reserved.
    createRegistry().service("then", () => undefined);

    createRegistry()
      .service("logger", () => undefined)
      // @ts-expect-error "then" is reserved even after other services exist.
      .service("then", () => undefined);
  });

  it("infers literal keys without manual `as const`", async () => {
    const services = await createRegistry()
      .service("logger", (): Logger => ({ log: (m) => m }))
      .resolve();

    expectTypeOf(services.logger).toEqualTypeOf<Logger>();
  });
});

describe("ServiceRegistry.value", () => {
  it("registers an instance under the given key with its original type", async () => {
    const services = await createRegistry()
      .value("config", { port: 3000 })
      .value("flag", true)
      .resolve();

    expectTypeOf(services.config).toEqualTypeOf<{ port: number }>();
    expectTypeOf(services.flag).toEqualTypeOf<boolean>();
  });

  it("rejects duplicate keys at the type level", () => {
    createRegistry()
      .value("config", { port: 3000 })
      // @ts-expect-error "config" already exists in the service map.
      .value("config", { port: 4000 });

    createRegistry()
      .service("logger", (): Logger => ({ log: (m) => m }))
      // @ts-expect-error "logger" already exists in the service map.
      .value("logger", { log: (m: string) => m });
  });

  it('reserves the "then" key for .value too', () => {
    // @ts-expect-error "then" is reserved.
    createRegistry().value("then", 1);
  });

  it("exposes the registered value through resolve", async () => {
    const services = await createRegistry()
      .value("config", { port: 3000 })
      .resolve();

    expectTypeOf(services.config).toEqualTypeOf<{ port: number }>();
  });
});

describe("ServiceRegistry.resolve", () => {
  it("returns a Promise of the service map intersected with AsyncDisposable", async () => {
    const registry = createRegistry().service("logger", (): Logger => ({
      log: (m) => m,
    }));

    expectTypeOf(registry.resolve).returns.toExtend<
      Promise<{ logger: Logger } & AsyncDisposable>
    >();

    const services = await registry.resolve();
    expectTypeOf(services[Symbol.asyncDispose]).toBeFunction();
    expectTypeOf(services[Symbol.asyncDispose]()).toEqualTypeOf<
      PromiseLike<void>
    >();
  });

  it("exposes only registered services on the resolved map", async () => {
    const services = await createRegistry()
      .service("logger", (): Logger => ({ log: (m) => m }))
      .resolve();

    expectTypeOf(services).toHaveProperty("logger");
    expectTypeOf(services).not.toHaveProperty("missing");
  });
});

describe("ServiceRegistry.replaceService", () => {
  it("takes no deps in the 2-arg form, like .service", () => {
    createRegistry()
      .service("logger", (): Logger => ({ log: (m) => m }))
      .service("db", ["logger"], ({ logger }): Db => ({
        query: (sql) => [logger.log(sql)],
      }))
      .replaceService("db", () => ({ query: (sql) => [sql] }));
  });

  it("receives exactly the deps declared in the 3-arg form", () => {
    createRegistry()
      .service("logger", (): Logger => ({ log: (m) => m }))
      .service("db", ["logger"], ({ logger }): Db => ({
        query: (sql) => [logger.log(sql)],
      }))
      .replaceService("db", ["logger"], (deps) => {
        expectTypeOf(deps).toEqualTypeOf<{ logger: Logger }>();
        return { query: (sql) => [sql] };
      });
  });

  it("accepts deps different from the original registration", () => {
    createRegistry()
      .value("config", { prefix: "stub" })
      .service("logger", (): Logger => ({ log: (m) => m }))
      .service("db", ["logger"], ({ logger }): Db => ({
        query: (sql) => [logger.log(sql)],
      }))
      .replaceService("db", ["config"], (deps) => {
        expectTypeOf(deps).toEqualTypeOf<{ config: { prefix: string } }>();
        return { query: (sql) => [`${deps.config.prefix}:${sql}`] };
      });
  });

  it("rejects replacing an unregistered key", () => {
    createRegistry()
      .service("logger", (): Logger => ({ log: (m) => m }))
      // @ts-expect-error "db" has not been registered.
      .replaceService("db", () => ({ query: () => [] }));
  });

  it("rejects an incompatible factory return type", () => {
    createRegistry()
      .service("logger", (): Logger => ({ log: (m) => m }))
      // @ts-expect-error number is not assignable to Logger.
      .replaceService("logger", () => 42);
  });

  it("rejects depending on an unregistered key in the 3-arg form", () => {
    createRegistry()
      .service("logger", (): Logger => ({ log: (m) => m }))
      // @ts-expect-error "missing" has not been registered.
      .replaceService("logger", ["missing"], () => ({ log: (m) => m }));
  });

  it("preserves the existing Services type", () => {
    const registry = createRegistry()
      .service("logger", (): Logger => ({ log: (m) => m }))
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      .replaceService("db", () => ({ query: (sql) => [sql] }));

    expectTypeOf(registry.resolve).returns.toExtend<
      Promise<{ logger: Logger; db: Db } & AsyncDisposable>
    >();
  });

  it("widens the service type to the replacement's extra members", async () => {
    const services = await createRegistry()
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      .replaceService("db", () => ({
        query: (sql: string) => [sql],
        add: (row: string) => [row],
      }))
      .resolve();

    expectTypeOf(services.db.add).toEqualTypeOf<(row: string) => string[]>();
    expectTypeOf(services.db.query).toEqualTypeOf<(sql: string) => string[]>();
  });

  it("judges each replacement against the original type, not the previous one", async () => {
    const services = await createRegistry()
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      .replaceService("db", () => ({
        query: (sql: string) => [sql],
        add: (row: string) => [row],
      }))
      // Only needs to satisfy the original `Db`, not the previous stub's `add`.
      .replaceService("db", () => ({
        query: (sql: string) => [sql],
        clear: () => undefined,
      }))
      .resolve();

    expectTypeOf(services.db.clear).toEqualTypeOf<() => undefined>();
    expectTypeOf(services.db).not.toHaveProperty("add");
  });

  it("rejects a replacement that drops the original contract", () => {
    createRegistry()
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      // @ts-expect-error missing `query`, so it is not assignable to Db.
      .replaceService("db", () => ({ add: (row: string) => [row] }));
  });

  it("unwraps a Promise replacement and keeps its extra members", () => {
    const registry = createRegistry()
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      .replaceService("db", () =>
        Promise.resolve({
          query: (sql: string) => [sql],
          add: (row: string) => [row],
        }),
      );

    expectTypeOf(registry.resolve).returns.toExtend<
      Promise<{
        db: {
          query: (sql: string) => string[];
          add: (row: string) => string[];
        };
      }>
    >();
  });
});

describe("ServiceRegistry.replaceValue", () => {
  it("accepts an instance matching the registered type", () => {
    const registry = createRegistry()
      .service("logger", (): Logger => ({ log: (m) => m }))
      .replaceValue("logger", { log: (m: string) => m });

    expectTypeOf(registry.resolve).returns.toExtend<
      Promise<{ logger: Logger } & AsyncDisposable>
    >();
  });

  it("rejects replacing an unregistered key", () => {
    createRegistry()
      .service("logger", (): Logger => ({ log: (m) => m }))
      // @ts-expect-error "db" has not been registered.
      .replaceValue("db", { query: () => [] });
  });

  it("rejects an incompatible instance type", () => {
    createRegistry()
      .service("logger", (): Logger => ({ log: (m) => m }))
      // @ts-expect-error number is not assignable to Logger.
      .replaceValue("logger", 42);
  });

  it("widens the service type to the instance's extra members", async () => {
    const rows: string[] = [];
    const stub = {
      query: (sql: string) => [sql],
      rows,
    };

    const services = await createRegistry()
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      .replaceValue("db", stub)
      .resolve();

    expectTypeOf(services.db.rows).toEqualTypeOf<string[]>();
    expectTypeOf(services.db.query).toEqualTypeOf<(sql: string) => string[]>();
  });
});
