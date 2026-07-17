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

  it("registers a class via .replaceService, widening to the class instance type", async () => {
    interface GreeterContract {
      greet: () => string;
    }
    class GreeterImpl implements GreeterContract {
      deps: { logger: Logger };
      constructor(deps: { logger: Logger }) {
        this.deps = deps;
      }
      greet() {
        return "hi";
      }
    }

    const services = await createRegistry()
      .service("logger", (): Logger => ({ log: () => undefined }))
      .service("greeter", (): GreeterContract => ({ greet: () => "hi" }))
      .replaceService("greeter", ["logger"], asClass(GreeterImpl))
      .resolve();

    expectTypeOf(services.greeter).toEqualTypeOf<GreeterImpl>();
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

  it("registers a dependency-free class via the no-deps .service overload", async () => {
    class Counter {
      count = 0;
    }

    // The factory must be assignable to the `() => Result` overload, so no
    // empty deps array is needed for a positional class with no dependencies.
    const services = await createRegistry()
      .service("counter", asClass(Counter, { positional: true }))
      .resolve();

    expectTypeOf(services.counter).toEqualTypeOf<Counter>();
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

  it("registers a dependency-free class via the no-deps .service overload", async () => {
    class Counter {
      count = 0;
    }

    const services = await createRegistry()
      .service("counter", asClassArgs(Counter))
      .resolve();

    expectTypeOf(services.counter).toEqualTypeOf<Counter>();
  });

  it("rejects registering when declared deps are fewer than constructor parameters", () => {
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
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      // @ts-expect-error "db" is missing from the declared deps but the constructor requires it.
      .service("repo", ["logger"], asClassArgs(Repo));
  });

  it("rejects using asClassArgs with a deps-object constructor (asClass is the right tool)", () => {
    class Greeter {
      deps: { logger: Logger; db: Db };
      constructor(deps: { logger: Logger; db: Db }) {
        this.deps = deps;
      }
    }

    createRegistry()
      .service("logger", (): Logger => ({ log: () => undefined }))
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      // @ts-expect-error Greeter takes a single object arg, not positional args — use asClass instead.
      .service("greeter", ["logger", "db"], asClassArgs(Greeter));
  });

  it("rejects registering when declared deps exceed constructor parameters", () => {
    class Logger2 {
      logger: Logger;
      constructor(logger: Logger) {
        this.logger = logger;
      }
    }

    createRegistry()
      .service("logger", (): Logger => ({ log: () => undefined }))
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      // @ts-expect-error Logger2 takes only (Logger) but "db" is also declared.
      .service("repo", ["logger", "db"], asClassArgs(Logger2));
  });

  it("rejects deps mismatch in the curried form", () => {
    class Repo {
      logger: Logger;
      db: Db;
      constructor(logger: Logger, db: Db) {
        this.logger = logger;
        this.db = db;
      }
    }

    interface RepoInterface {
      find: () => string[];
    }

    createRegistry()
      .service("logger", (): Logger => ({ log: () => undefined }))
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      // @ts-expect-error "db" is missing from the declared deps.
      .service("repo", ["logger"], asClassArgs<RepoInterface>()(Repo));
  });

  it("pins the return type to the interface in the curried form", () => {
    interface Repo {
      find: () => string[];
    }
    class RepoImpl implements Repo {
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

    const factory = asClassArgs<Repo>()(RepoImpl);
    expectTypeOf(factory).returns.toEqualTypeOf<Repo>();
  });

  it("accepts a factory whose parameter type is wider than the registered value type", () => {
    type LogLevel = "debug" | "info" | "warn" | "error";
    class Logger2 {
      readonly logLevel: LogLevel;
      constructor(logLevel: LogLevel) {
        this.logLevel = logLevel;
      }
    }

    // "error" as const is a subtype of LogLevel, so passing Logger2 is safe.
    createRegistry()
      .value("logLevel", "error" as const)
      .service("logger", ["logLevel"], asClassArgs(Logger2));
  });

  it("accepts a factory whose parameter type is a supertype of the registered service type", () => {
    interface ILogger {
      log: (msg: string) => void;
    }
    class Logger2 implements ILogger {
      log(_msg: string) {}
    }
    class Service {
      readonly logger: ILogger;
      constructor(logger: ILogger) {
        this.logger = logger;
      }
    }

    // Logger2 implements ILogger, so passing Logger2 where ILogger is expected is safe.
    createRegistry()
      .service("logger", asClassArgs(Logger2))
      .service("service", ["logger"], asClassArgs(Service));
  });
});

describe("asClass<Interface>() (curried)", () => {
  interface Greeter {
    greet: () => string;
  }

  class GreeterImpl implements Greeter {
    deps: { logger: Logger; db: Db };
    constructor(deps: { logger: Logger; db: Db }) {
      this.deps = deps;
    }
    greet() {
      return "hi";
    }
  }

  it("pins the return type to the interface while inferring deps", () => {
    const factory = asClass<Greeter>()(GreeterImpl);
    expectTypeOf(factory).parameter(0).toEqualTypeOf<{
      logger: Logger;
      db: Db;
    }>();
    expectTypeOf(factory).returns.toEqualTypeOf<Greeter>();
  });

  it("rejects a class whose instance does not satisfy the interface", () => {
    class NotGreeter {
      logger: Logger;
      constructor(deps: { logger: Logger }) {
        this.logger = deps.logger;
      }
      farewell() {
        return "bye";
      }
    }

    // @ts-expect-error NotGreeter has no `greet`, so it is not assignable to Greeter.
    asClass<Greeter>()(NotGreeter);
  });

  it("pins the return type for a positional constructor too", () => {
    interface Repo {
      find: () => string[];
    }
    class RepoImpl implements Repo {
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

    const factory = asClass<Repo>()(RepoImpl, { positional: true });
    expectTypeOf(factory).returns.toEqualTypeOf<Repo>();
  });
});
