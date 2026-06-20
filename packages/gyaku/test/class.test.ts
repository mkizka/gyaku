import { describe, expect, it } from "vitest";

import { asClass, asClassArgs, createRegistry } from "../src/index.ts";

class Logger {
  readonly lines: string[] = [];
  log(message: string) {
    this.lines.push(message);
  }
}

describe("asClass", () => {
  it("builds a class from a single dependency object", async () => {
    class Greeter {
      readonly #logger: Logger;
      constructor({ logger }: { logger: Logger }) {
        this.#logger = logger;
      }
      greet(name: string) {
        this.#logger.log(`hello, ${name}`);
        return `hello, ${name}`;
      }
    }

    await using services = await createRegistry()
      .service("logger", () => new Logger())
      .service("greeter", ["logger"], asClass(Greeter))
      .resolve();

    expect(services.greeter).toBeInstanceOf(Greeter);
    expect(services.greeter.greet("gyaku")).toBe("hello, gyaku");
    expect(services.logger.lines).toEqual(["hello, gyaku"]);
  });

  it("passes the same resolved dependency instances to the constructor", async () => {
    class Holder {
      readonly logger: Logger;
      constructor({ logger }: { logger: Logger }) {
        this.logger = logger;
      }
    }

    await using services = await createRegistry()
      .service("logger", () => new Logger())
      .service("holder", ["logger"], asClass(Holder))
      .resolve();

    expect(services.holder.logger).toBe(services.logger);
  });
});

describe("asClassArgs", () => {
  it("spreads resolved dependencies into positional constructor args in deps order", async () => {
    class Db {
      query(sql: string) {
        return [sql];
      }
    }

    class Repo {
      readonly #logger: Logger;
      readonly #db: Db;
      constructor(logger: Logger, db: Db) {
        this.#logger = logger;
        this.#db = db;
      }
      find(sql: string) {
        this.#logger.log(sql);
        return this.#db.query(sql);
      }
    }

    await using services = await createRegistry()
      .service("logger", () => new Logger())
      .service("db", () => new Db())
      .service("repo", ["logger", "db"], asClassArgs(Repo))
      .resolve();

    expect(services.repo).toBeInstanceOf(Repo);
    expect(services.repo.find("select 1")).toEqual(["select 1"]);
    expect(services.logger.lines).toEqual(["select 1"]);
  });

  it("builds a dependency-free class registered without a deps array", async () => {
    class Counter {
      count = 0;
    }

    await using services = await createRegistry()
      .service("counter", asClassArgs(Counter))
      .resolve();

    expect(services.counter).toBeInstanceOf(Counter);
  });

  it("builds a class when the factory is called without deps", () => {
    class Counter {
      count = 0;
    }

    expect(asClassArgs(Counter)()).toBeInstanceOf(Counter);
  });

  it("follows the deps array order, not the registration order", async () => {
    class Pair {
      readonly first: string;
      readonly second: string;
      constructor(first: string, second: string) {
        this.first = first;
        this.second = second;
      }
    }

    await using services = await createRegistry()
      .value("a", "value-a")
      .value("b", "value-b")
      // deps order ["b", "a"] maps to constructor(first = b, second = a).
      .service("pair", ["b", "a"], asClassArgs(Pair))
      .resolve();

    expect(services.pair.first).toBe("value-b");
    expect(services.pair.second).toBe("value-a");
  });
});

describe("asClass with { positional: true } (deprecated)", () => {
  it("still spreads dependencies into positional constructor args, like asClassArgs", async () => {
    class Db {
      query(sql: string) {
        return [sql];
      }
    }

    class Repo {
      readonly #logger: Logger;
      readonly #db: Db;
      constructor(logger: Logger, db: Db) {
        this.#logger = logger;
        this.#db = db;
      }
      find(sql: string) {
        this.#logger.log(sql);
        return this.#db.query(sql);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-deprecated -- exercising the deprecated overload on purpose to keep it working.
    const repoFactory = asClass(Repo, { positional: true });

    await using services = await createRegistry()
      .service("logger", () => new Logger())
      .service("db", () => new Db())
      .service("repo", ["logger", "db"], repoFactory)
      .resolve();

    expect(services.repo).toBeInstanceOf(Repo);
    expect(services.repo.find("select 1")).toEqual(["select 1"]);
    expect(services.logger.lines).toEqual(["select 1"]);
  });
});
