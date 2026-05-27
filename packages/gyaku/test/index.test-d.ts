import { assertType, describe, expectTypeOf, it } from "vitest";

import { type ContainerBuilder, createContainer } from "../src/index.ts";

type Logger = { log: (message: string) => string };
type Db = { query: (sql: string) => string[] };
type Repo = { find: () => string[] };

describe("createContainer", () => {
  it("starts with an empty service map", () => {
    expectTypeOf(createContainer()).toEqualTypeOf<
      ContainerBuilder<Record<never, never>, Record<never, readonly []>>
    >();
  });
});

describe("ContainerBuilder.service", () => {
  it("accumulates services across chained registrations", async () => {
    const container = createContainer()
      .service("logger", (): Logger => ({ log: (message) => message }))
      .service(
        "db",
        (): Promise<Db> => Promise.resolve({ query: (sql: string) => [sql] }),
      )
      .service(
        "repo",
        ["db"],
        ({ db }): Repo => ({ find: () => db.query("select 1") }),
      );

    const services = await container.build();

    expectTypeOf(services.logger).toEqualTypeOf<Logger>();
    expectTypeOf(services.db).toEqualTypeOf<Db>();
    expectTypeOf(services.repo).toEqualTypeOf<Repo>();
  });

  it("unwraps Promise return values via Awaited", () => {
    const container = createContainer().service("db", () =>
      Promise.resolve({ query: (sql: string) => [sql] }),
    );

    expectTypeOf(container.build()).resolves.toExtend<{ db: Db }>();
  });

  it("passes only declared dependencies to the factory", () => {
    createContainer()
      .service("logger", (): Logger => ({ log: (m) => m }))
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      .service("repo", ["db"], (deps) => {
        expectTypeOf(deps).toEqualTypeOf<{ db: Db }>();
        return { find: () => deps.db.query("select 1") };
      });
  });

  it("widens deps when more keys are declared", () => {
    createContainer()
      .service("logger", (): Logger => ({ log: (m) => m }))
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      .service("repo", ["db", "logger"], (deps) => {
        expectTypeOf(deps).toEqualTypeOf<{ db: Db; logger: Logger }>();
        return { find: () => deps.db.query("select 1") };
      });
  });

  it("rejects dependencies that are not yet registered", () => {
    createContainer()
      .service("logger", (): Logger => ({ log: (m) => m }))
      // @ts-expect-error "db" has not been registered.
      .service("repo", ["db"], () => undefined);
  });

  it("rejects duplicate service keys", () => {
    createContainer()
      .service("logger", () => undefined)
      // @ts-expect-error "logger" already exists in the service map.
      .service("logger", () => undefined);
  });

  it('reserves the "then" key to avoid thenable collisions', () => {
    // @ts-expect-error "then" is reserved.
    createContainer().service("then", () => undefined);

    createContainer()
      .service("logger", () => undefined)
      // @ts-expect-error "then" is reserved even after other services exist.
      .service("then", () => undefined);
  });

  it("infers literal keys without manual `as const`", () => {
    const container = createContainer().service(
      "logger",
      (): Logger => ({
        log: (m) => m,
      }),
    );

    expectTypeOf(container).toExtend<
      ContainerBuilder<{ logger: Logger }, { logger: readonly [] }>
    >();
  });
});

describe("ContainerBuilder.value", () => {
  it("registers an instance under the given key with its original type", () => {
    type Config = { port: number };

    const container = createContainer()
      .value("config", { port: 3000 })
      .value("flag", true);

    expectTypeOf(container).toExtend<
      ContainerBuilder<
        { config: Config; flag: boolean },
        { config: readonly []; flag: readonly [] }
      >
    >();
  });

  it("rejects duplicate keys at the type level", () => {
    createContainer()
      .value("config", { port: 3000 })
      // @ts-expect-error "config" already exists in the service map.
      .value("config", { port: 4000 });

    createContainer()
      .service("logger", (): Logger => ({ log: (m) => m }))
      // @ts-expect-error "logger" already exists in the service map.
      .value("logger", { log: (m: string) => m });
  });

  it('reserves the "then" key for .value too', () => {
    // @ts-expect-error "then" is reserved.
    createContainer().value("then", 1);
  });

  it("exposes the registered value through build", async () => {
    const services = await createContainer()
      .value("config", { port: 3000 })
      .build();

    expectTypeOf(services.config).toEqualTypeOf<{ port: number }>();
  });
});

describe("ContainerBuilder.build", () => {
  it("returns a Promise of the service map intersected with AsyncDisposable", async () => {
    const container = createContainer().service(
      "logger",
      (): Logger => ({ log: (m) => m }),
    );

    expectTypeOf(container.build).returns.toExtend<
      Promise<{ logger: Logger } & AsyncDisposable>
    >();

    const services = await container.build();
    expectTypeOf(services[Symbol.asyncDispose]).toBeFunction();
    expectTypeOf(services[Symbol.asyncDispose]()).toEqualTypeOf<
      PromiseLike<void>
    >();
  });

  it("exposes only registered services on the built map", async () => {
    const services = await createContainer()
      .service("logger", (): Logger => ({ log: (m) => m }))
      .build();

    expectTypeOf(services).toHaveProperty("logger");
    expectTypeOf(services).not.toHaveProperty("missing");
  });
});

describe("ContainerBuilder.override", () => {
  it("inherits the original service's deps shape", () => {
    createContainer()
      .service("logger", (): Logger => ({ log: (m) => m }))
      .service(
        "db",
        ["logger"],
        ({ logger }): Db => ({ query: (sql) => [logger.log(sql)] }),
      )
      .override("db", (deps) => {
        expectTypeOf(deps).toEqualTypeOf<{ logger: Logger }>();
        return { query: (sql) => [sql] };
      });
  });

  it("accepts a no-arg factory when the original service had no deps", () => {
    createContainer()
      .service("logger", (): Logger => ({ log: (m) => m }))
      .override("logger", () => ({ log: (m) => m }));
  });

  it("rejects overriding an unregistered key", () => {
    createContainer()
      .service("logger", (): Logger => ({ log: (m) => m }))
      // @ts-expect-error "db" has not been registered.
      .override("db", () => ({ query: () => [] }));
  });

  it("rejects an incompatible factory return type", () => {
    createContainer()
      .service("logger", (): Logger => ({ log: (m) => m }))
      // @ts-expect-error number is not assignable to Logger.
      .override("logger", () => 42);
  });

  it("preserves the existing Services type", () => {
    const container = createContainer()
      .service("logger", (): Logger => ({ log: (m) => m }))
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      .override("db", () => ({ query: (sql) => [sql] }));

    expectTypeOf(container.build).returns.toExtend<
      Promise<{ logger: Logger; db: Db } & AsyncDisposable>
    >();
  });
});

describe("assertType usage", () => {
  it("validates concrete factory inputs and outputs", () => {
    const container = createContainer()
      .service("logger", (): Logger => ({ log: (m) => m }))
      .service("db", (): Db => ({ query: (sql) => [sql] }));

    assertType<
      ContainerBuilder<
        { logger: Logger; db: Db },
        { logger: readonly []; db: readonly [] }
      >
    >(container);
  });
});
