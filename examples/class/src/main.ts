import assert from "node:assert/strict";

import { asClass, asClassArgs, createRegistry } from "@gyaku/di";

class Logger {
  log(message: string) {
    console.log(`[log] ${message}`);
  }
}

class Db {
  #logger: Logger;

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  // Async setup belongs in a static factory: it already receives the deps
  // object gyaku passes, so it needs no helper.
  static async create({ logger }: { logger: Logger }) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    logger.log("db connected");
    return new Db(logger);
  }

  async findName(id: number) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return `user-${id}`;
  }

  async [Symbol.asyncDispose]() {
    this.#logger.log("db disconnected");
  }
}

// Object-argument constructor: `asClass` passes the resolved deps straight in.
class Greeter {
  #logger: Logger;
  #db: Db;

  constructor({ logger, db }: { logger: Logger; db: Db }) {
    this.#logger = logger;
    this.#db = db;
  }

  async say(id: number) {
    const name = await this.#db.findName(id);
    this.#logger.log(`saying hello to ${name}`);
    return `hello, ${name}!`;
  }

  async [Symbol.asyncDispose]() {
    this.#logger.log("greeter disposed");
  }
}

// Positional-argument constructor: `asClassArgs` spreads deps into the
// parameters in the order listed in `.service`, so existing classes can be
// registered unchanged.
class Farewell {
  #logger: Logger;
  #db: Db;

  constructor(logger: Logger, db: Db) {
    this.#logger = logger;
    this.#db = db;
  }

  async say(id: number) {
    const name = await this.#db.findName(id);
    this.#logger.log(`saying bye to ${name}`);
    return `bye, ${name}!`;
  }
}

const registry = createRegistry()
  .service("logger", () => new Logger())
  .service("db", ["logger"], Db.create)
  .service("greeter", ["logger", "db"], asClass(Greeter))
  .service("farewell", ["logger", "db"], asClassArgs(Farewell));

const main = async () => {
  await using app = await registry.resolve();

  const hello = await app.greeter.say(1);
  assert.equal(hello, "hello, user-1!");
  console.log(hello);

  const bye = await app.farewell.say(1);
  assert.equal(bye, "bye, user-1!");
  console.log(bye);
};

await main();
