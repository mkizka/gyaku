import { describe, expectTypeOf, it } from "vitest";

import { asClass, createRegistry } from "../src/index.ts";

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

describe("replacing a class-based service", () => {
  class UserService {
    private logger: Logger;
    constructor(deps: { logger: Logger }) {
      this.logger = deps.logger;
    }
    getUser(id: string) {
      this.logger.log(id);
      return { id };
    }
  }

  const registry = () =>
    createRegistry()
      .service("logger", (): Logger => ({ log: () => undefined }))
      .service("userService", ["logger"], asClass(UserService));

  it("accepts a replaceService stub matching only the public members", () => {
    registry().replaceService("userService", () => ({
      getUser: (id: string) => ({ id }),
    }));
  });

  it("accepts a replaceValue stub matching only the public members", () => {
    registry().replaceValue("userService", {
      getUser: (id: string) => ({ id }),
    });
  });

  it("rejects a stub that drops a public member", () => {
    // @ts-expect-error missing `getUser`.
    registry().replaceService("userService", () => ({}));
  });

  it("rejects a stub whose public member has a wrong type", () => {
    registry().replaceValue("userService", {
      // @ts-expect-error `getUser` must return `{ id: string }`.
      getUser: (id: string) => id,
    });
  });
});

describe("asClass with { positional: true }", () => {
  it("infers the instance type from the constructor", () => {
    class Repo {
      logger: Logger;
      db: Db;
      constructor(logger: Logger, db: Db) {
        this.logger = logger;
        this.db = db;
      }
    }

    const factory = asClass(Repo, { positional: true });
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
      .service("repo", ["logger", "db"], asClass(Repo, { positional: true }))
      .resolve();

    expectTypeOf(services.repo).toEqualTypeOf<Repo>();
  });
});
