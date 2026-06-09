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
  it("zips keys with positional constructor parameters", () => {
    class Repo {
      logger: Logger;
      db: Db;
      constructor(logger: Logger, db: Db) {
        this.logger = logger;
        this.db = db;
      }
    }

    const factory = asClassArgs(Repo, ["logger", "db"]);
    expectTypeOf(factory).parameter(0).toEqualTypeOf<{
      logger: Logger;
      db: Db;
    }>();
    expectTypeOf(factory).returns.toEqualTypeOf<Repo>();
  });

  it("maps each key to the parameter at the same position", () => {
    class Repo {
      db: Db;
      logger: Logger;
      constructor(db: Db, logger: Logger) {
        this.db = db;
        this.logger = logger;
      }
    }

    // Keys follow the parameter order: first the Db parameter, then Logger.
    const factory = asClassArgs(Repo, ["db", "logger"]);
    expectTypeOf(factory).parameter(0).toEqualTypeOf<{
      db: Db;
      logger: Logger;
    }>();
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
      .service("repo", ["logger", "db"], asClassArgs(Repo, ["logger", "db"]))
      .resolve();

    expectTypeOf(services.repo).toEqualTypeOf<Repo>();
  });

  it("rejects a key list shorter than the constructor parameters", () => {
    class Repo {
      logger: Logger;
      db: Db;
      constructor(logger: Logger, db: Db) {
        this.logger = logger;
        this.db = db;
      }
    }

    // @ts-expect-error one key per constructor parameter is required.
    asClassArgs(Repo, ["logger"]);
  });

  it("rejects a key list longer than the constructor parameters", () => {
    class Repo {
      logger: Logger;
      constructor(logger: Logger) {
        this.logger = logger;
      }
    }

    // @ts-expect-error one key per constructor parameter is required.
    asClassArgs(Repo, ["logger", "db"]);
  });

  it("rejects a dependency whose type does not match the parameter", () => {
    class Repo {
      logger: Logger;
      db: Db;
      constructor(logger: Logger, db: Db) {
        this.logger = logger;
        this.db = db;
      }
    }

    createRegistry()
      .service("logger", (): Logger => ({ log: () => undefined }))
      .service("db", () => 42)
      // @ts-expect-error number is not assignable to the Db parameter.
      .service("repo", ["logger", "db"], asClassArgs(Repo, ["logger", "db"]));
  });
});
