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
  it("maps named dependencies to positional constructor arguments", async () => {
    const order: string[] = [];

    class Db {
      query(sql: string) {
        return [sql];
      }
    }

    class Repo {
      readonly #logger: Logger;
      readonly #db: Db;
      constructor(logger: Logger, db: Db) {
        order.push("logger", "db");
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
      .service("repo", ["logger", "db"], asClassArgs(Repo, ["logger", "db"]))
      .resolve();

    expect(services.repo).toBeInstanceOf(Repo);
    expect(services.repo.find("select 1")).toEqual(["select 1"]);
    expect(services.logger.lines).toEqual(["select 1"]);
    expect(order).toEqual(["logger", "db"]);
  });

  it("respects the key order rather than the declared dependency order", async () => {
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
      // Reverse the order so it cannot accidentally match the registry order.
      .service("pair", ["a", "b"], asClassArgs(Pair, ["b", "a"]))
      .resolve();

    expect(services.pair.first).toBe("value-b");
    expect(services.pair.second).toBe("value-a");
  });
});
