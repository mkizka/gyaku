import assert from "node:assert/strict";

import { createContainer } from "@gyaku/di";

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

class Greeter {
  #logger: Logger;
  #db: Db;

  constructor(logger: Logger, db: Db) {
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

const container = createContainer()
  .service("logger", () => new Logger())
  .service("db", ["logger"], Db.create)
  .service(
    "greeter",
    ["logger", "db"],
    ({ logger, db }: { logger: Logger; db: Db }) => new Greeter(logger, db),
  );

const main = async () => {
  await using app = await container.build();
  const message = await app.greeter.say(1);
  assert.equal(message, "hello, user-1!");
  console.log(message);
};

await main();
