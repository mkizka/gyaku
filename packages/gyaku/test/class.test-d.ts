import { describe, expectTypeOf, it } from "vitest";

import { asClass, asClassArgs, createRegistry } from "../src/index.ts";

type Logger = { log: (message: string) => void };
type Db = { query: (sql: string) => string[] };

describe("asClass", () => {
  it("infers the factory dependency object from the constructor", () => {
    class Greeter {
      deps: { logger: Logger; db: Db };
      constructor(deps: { logger: Logger; db: Db }) {
        this.deps = deps;
      }
    }

    const factory = asClass(Greeter);
    expectTypeOf(factory).parameter(0).toEqualTypeOf<{
      logger: Logger;
      db: Db;
    }>();
    expectTypeOf(factory).returns.toEqualTypeOf<Greeter>();
  });

  it("registers a class via .service and exposes its instance type", async () => {
    class Greeter {
      deps: { logger: Logger; db: Db };
      constructor(deps: { logger: Logger; db: Db }) {
        this.deps = deps;
      }
      greet() {
        return "hi";
      }
    }

    const services = await createRegistry()
      .service("logger", (): Logger => ({ log: () => undefined }))
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      .service("greeter", ["logger", "db"], asClass(Greeter))
      .resolve();

    expectTypeOf(services.greeter).toEqualTypeOf<Greeter>();
  });

  it("rejects registering a class whose dependencies are not declared", () => {
    class Greeter {
      deps: { logger: Logger; db: Db };
      constructor(deps: { logger: Logger; db: Db }) {
        this.deps = deps;
      }
    }

    createRegistry()
      .service("logger", (): Logger => ({ log: () => undefined }))
      // @ts-expect-error "db" is missing from the declared dependencies.
      .service("greeter", ["logger"], asClass(Greeter));
  });
});

describe("asClassArgs", () => {
  it("infers the instance type from the constructor", () => {
    class Repo {
      logger: Logger;
      db: Db;
      constructor(logger: Logger, db: Db) {
        this.logger = logger;
        this.db = db;
      }
    }

    const factory = asClassArgs(Repo);
    expectTypeOf(factory).returns.toEqualTypeOf<Repo>();
  });

  it("registers a positional-constructor class via .service", async () => {
    class Repo {
      logger: Logger;
      db: Db;
      constructor(logger: Logger, db: Db) {
        this.logger = logger;
        this.db = db;
      }
      find() {
        return this.db.query("select 1");
      }
    }

    const services = await createRegistry()
      .service("logger", (): Logger => ({ log: () => undefined }))
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      .service("repo", ["logger", "db"], asClassArgs(Repo))
      .resolve();

    expectTypeOf(services.repo).toEqualTypeOf<Repo>();
  });

  it("registers a dependency-free class via the no-deps .service overload", async () => {
    class Counter {
      count = 0;
    }

    // The factory must be assignable to the `() => Result` overload, so no
    // empty deps array is needed for a positional class with no dependencies.
    const services = await createRegistry()
      .service("counter", asClassArgs(Counter))
      .resolve();

    expectTypeOf(services.counter).toEqualTypeOf<Counter>();
  });
});
