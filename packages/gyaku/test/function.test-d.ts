import { describe, expectTypeOf, it } from "vitest";

import { asFunctionArgs, createRegistry } from "../src/index.ts";

type Logger = { log: (message: string) => void };
type Db = { query: (sql: string) => string[] };

describe("asFunctionArgs", () => {
  it("infers the result type from the factory", () => {
    const createRepo = (logger: Logger, db: Db) => ({ logger, db });

    const factory = asFunctionArgs(createRepo);
    expectTypeOf(factory).returns.toEqualTypeOf<{ logger: Logger; db: Db }>();
  });

  it("registers a dependency-free factory via the no-deps .service overload", async () => {
    const createCounter = () => ({ count: 0 });

    const services = await createRegistry()
      .service("counter", asFunctionArgs(createCounter))
      .resolve();

    expectTypeOf(services.counter).toEqualTypeOf<{ count: number }>();
  });

  it("unwraps a Promise result via Awaited when registered", async () => {
    const createDb = async (): Promise<Db> =>
      Promise.resolve({ query: (sql) => [sql] });

    const services = await createRegistry()
      .service("db", asFunctionArgs(createDb))
      .resolve();

    expectTypeOf(services.db).toEqualTypeOf<Db>();
  });

  it("spreads resolved dependencies into positional args in deps order", async () => {
    const createRepo = (logger: Logger, db: Db) => ({ logger, db });

    const services = await createRegistry()
      .service("logger", (): Logger => ({ log: () => undefined }))
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      .service("repo", ["logger", "db"], asFunctionArgs(createRepo))
      .resolve();

    expectTypeOf(services.repo).toEqualTypeOf<{ logger: Logger; db: Db }>();
  });

  it("rejects registering when declared deps are fewer than factory parameters", () => {
    const createRepo = (logger: Logger, db: Db) => ({ logger, db });

    createRegistry()
      .service("logger", (): Logger => ({ log: () => undefined }))
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      // @ts-expect-error "db" is missing from the declared deps but the factory requires it.
      .service("repo", ["logger"], asFunctionArgs(createRepo));
  });

  it("rejects registering when declared deps exceed factory parameters", () => {
    const createLogger2 = (logger: Logger) => ({ logger });

    createRegistry()
      .service("logger", (): Logger => ({ log: () => undefined }))
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      // @ts-expect-error createLogger2 takes only (Logger) but "db" is also declared.
      .service("repo", ["logger", "db"], asFunctionArgs(createLogger2));
  });

  it("accepts a factory whose parameter type is wider than the registered value type", () => {
    type LogLevel = "debug" | "info" | "warn" | "error";
    const createLogger2 = (logLevel: LogLevel) => ({ logLevel });

    // "error" as const is a subtype of LogLevel, so passing createLogger2 is safe.
    createRegistry()
      .value("logLevel", "error" as const)
      .service("logger", ["logLevel"], asFunctionArgs(createLogger2));
  });

  it("pins the registered type to the factory's return annotation", async () => {
    interface Repo {
      find: () => string[];
    }
    // Annotating the return type pins the registered type to the interface,
    // so no curried form is needed.
    const createRepo = (db: Db): Repo => ({ find: () => db.query("select 1") });

    const services = await createRegistry()
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      .service("repo", ["db"], asFunctionArgs(createRepo))
      .resolve();

    expectTypeOf(services.repo).toEqualTypeOf<Repo>();
  });
});
