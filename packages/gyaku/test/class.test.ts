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

  it("replaces a service with a class stub via .replaceService", async () => {
    class Greeter {
      readonly #logger: Logger;
      constructor({ logger }: { logger: Logger }) {
        this.#logger = logger;
      }
      greet(name: string) {
        this.#logger.log(`stub:${name}`);
        return `stub:${name}`;
      }
    }

    await using services = await createRegistry()
      .service("logger", () => new Logger())
      .service("greeter", () => ({ greet: (name: string) => `real:${name}` }))
      .replaceService("greeter", ["logger"], asClass(Greeter))
      .resolve();

    expect(services.greeter.greet("gyaku")).toBe("stub:gyaku");
    expect(services.logger.lines).toEqual(["stub:gyaku"]);
  });
});

describe("asClassArgs", () => {
  it("spreads resolved dependencies into positional constructor args in deps order", async () => {
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

  it("builds a dependency-free class registered without a deps array", async () => {
    class Counter {
      count = 0;
    }

    await using services = await createRegistry()
      .service("counter", asClassArgs(Counter))
      .resolve();

    expect(services.counter).toBeInstanceOf(Counter);
  });
});

describe("asClassArgs<Interface>() (curried)", () => {
  // The curried form returns the same factory as the direct form, so one case
  // is enough to cover its runtime behavior; the type contract is checked in
  // class.test-d.ts.
  it("builds the instance just like the direct form", async () => {
    interface Repo {
      find: (sql: string) => string[];
    }
    class Db {
      query(sql: string) {
        return [sql];
      }
    }
    class RepoImpl implements Repo {
      readonly #db: Db;
      constructor(db: Db) {
        this.#db = db;
      }
      find(sql: string) {
        return this.#db.query(sql);
      }
    }

    await using services = await createRegistry()
      .service("db", () => new Db())
      .service("repo", ["db"], asClassArgs<Repo>()(RepoImpl))
      .resolve();

    expect(services.repo.find("select 1")).toEqual(["select 1"]);
  });
});

describe("asClass<Interface>() (curried)", () => {
  // The curried form returns the same factory as the direct form, so one case
  // is enough to cover its runtime behavior; the type contract is checked in
  // class.test-d.ts.
  it("builds the instance just like the direct form", async () => {
    interface Greeter {
      greet: (name: string) => string;
    }
    class GreeterImpl implements Greeter {
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
      .service("greeter", ["logger"], asClass<Greeter>()(GreeterImpl))
      .resolve();

    expect(services.greeter.greet("gyaku")).toBe("hello, gyaku");
    expect(services.logger.lines).toEqual(["hello, gyaku"]);
  });
});
