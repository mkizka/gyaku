import { describe, expectTypeOf, it } from "vitest";

import { asFunctionArgs, createRegistry } from "../src/index.ts";

type Logger = { log: (message: string) => void };
type Db = { query: (sql: string) => string[] };

describe("asFunctionArgs", () => {
  it("registers a dependency-free factory via the no-deps .service overload", async () => {
    const createCounter = () => ({ count: 0 });

    const services = await createRegistry()
      .service("counter", asFunctionArgs(createCounter))
      .resolve();

    expectTypeOf(services.counter).toEqualTypeOf<{ count: number }>();
  });

  it("infers the result type and spreads deps into positional args in order", async () => {
    const createRepo = (logger: Logger, db: Db) => ({ logger, db });

    const services = await createRegistry()
      .service("logger", (): Logger => ({ log: () => undefined }))
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      .service("repo", ["logger", "db"], asFunctionArgs(createRepo))
      .resolve();

    expectTypeOf(services.repo).toEqualTypeOf<{ logger: Logger; db: Db }>();
  });

  it("unwraps a Promise result via Awaited when registered", async () => {
    const createDb = async (): Promise<Db> =>
      Promise.resolve({ query: (sql) => [sql] });

    const services = await createRegistry()
      .service("db", asFunctionArgs(createDb))
      .resolve();

    expectTypeOf(services.db).toEqualTypeOf<Db>();
  });

  it("rejects declared deps that do not match the factory parameters", () => {
    const createRepo = (logger: Logger, db: Db) => ({ logger, db });
    const createLogger2 = (logger: Logger) => ({ logger });

    createRegistry()
      .service("logger", (): Logger => ({ log: () => undefined }))
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      // @ts-expect-error "db" is missing from the declared deps but the factory requires it.
      .service("repo", ["logger"], asFunctionArgs(createRepo));

    createRegistry()
      .service("logger", (): Logger => ({ log: () => undefined }))
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      // @ts-expect-error createLogger2 takes only (Logger) but "db" is also declared.
      .service("repo", ["logger", "db"], asFunctionArgs(createLogger2));
  });

  it("registers a positional factory via .replaceService", async () => {
    const createDb = (logger: Logger): Db => ({
      query: (sql) => {
        logger.log(sql);
        return [sql];
      },
    });

    const services = await createRegistry()
      .service("logger", (): Logger => ({ log: () => undefined }))
      .service("db", (): Db => ({ query: (sql) => [sql] }))
      .replaceService("db", ["logger"], asFunctionArgs(createDb))
      .resolve();

    expectTypeOf(services.db).toEqualTypeOf<Db>();
  });
});
