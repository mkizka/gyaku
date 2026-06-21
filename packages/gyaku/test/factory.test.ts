import { describe, expect, it } from "vitest";

import { asFactoryArgs, createRegistry } from "../src/index.ts";

type Logger = { log: (message: string) => void; lines: string[] };

const createLogger = (): Logger => {
  const lines: string[] = [];
  return { lines, log: (message) => lines.push(message) };
};

describe("asFactoryArgs", () => {
  it("spreads resolved dependencies into positional factory args in deps order", async () => {
    const createPair = (first: string, second: string) => ({ first, second });

    await using services = await createRegistry()
      .value("a", "value-a")
      .value("b", "value-b")
      // deps order ["b", "a"] maps to createPair(first = b, second = a).
      .service("pair", ["b", "a"], asFactoryArgs(createPair))
      .resolve();

    expect(services.pair.first).toBe("value-b");
    expect(services.pair.second).toBe("value-a");
  });

  it("passes the same resolved dependency instances to the factory", async () => {
    const createHolder = (logger: Logger) => ({ logger });

    await using services = await createRegistry()
      .service("logger", createLogger)
      .service("holder", ["logger"], asFactoryArgs(createHolder))
      .resolve();

    expect(services.holder.logger).toBe(services.logger);
  });

  it("builds a dependency-free factory registered without a deps array", async () => {
    const createCounter = () => ({ count: 0 });

    await using services = await createRegistry()
      .service("counter", asFactoryArgs(createCounter))
      .resolve();

    expect(services.counter).toEqual({ count: 0 });
  });

  it("awaits an async factory's resolved value", async () => {
    const createGreeting = async (name: string) =>
      Promise.resolve(`hello, ${name}`);

    await using services = await createRegistry()
      .value("name", "gyaku")
      .service("greeting", ["name"], asFactoryArgs(createGreeting))
      .resolve();

    expect(services.greeting).toBe("hello, gyaku");
  });

  it("builds the value when the adapted factory is called with empty deps", () => {
    const createCounter = () => ({ count: 0 });

    expect(asFactoryArgs(createCounter)({})).toEqual({ count: 0 });
  });
});

describe("asFactoryArgs<Type>() (curried)", () => {
  // The curried form returns the same factory as the direct form, so one case
  // is enough to cover its runtime behavior; the type contract is checked in
  // factory.test-d.ts.
  it("builds the value just like the direct form", async () => {
    interface Repo {
      find: (sql: string) => string[];
    }
    const createRepo = (logger: Logger): Repo => ({
      find: (sql) => {
        logger.log(sql);
        return [sql];
      },
    });

    await using services = await createRegistry()
      .service("logger", createLogger)
      .service("repo", ["logger"], asFactoryArgs<Repo>()(createRepo))
      .resolve();

    expect(services.repo.find("select 1")).toEqual(["select 1"]);
    expect(services.logger.lines).toEqual(["select 1"]);
  });
});
