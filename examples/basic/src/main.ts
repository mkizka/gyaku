import assert from "node:assert/strict";

import { createContainer } from "@gyaku/di";

type Logger = { log: (message: string) => void };

const createLogger = (): Logger => ({
  log: (message) => console.log(`[log] ${message}`),
});

type Db = {
  findName: (id: number) => Promise<string>;
  [Symbol.asyncDispose]: () => Promise<void>;
};

const createDb = async ({ logger }: { logger: Logger }): Promise<Db> => {
  await new Promise((resolve) => setTimeout(resolve, 10));
  logger.log("db connected");
  return {
    findName: async (id) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return `user-${id}`;
    },
    [Symbol.asyncDispose]: async () => {
      logger.log("db disconnected");
    },
  };
};

const createGreeter = ({ logger, db }: { logger: Logger; db: Db }) => ({
  say: async (id: number) => {
    const name = await db.findName(id);
    logger.log(`saying hello to ${name}`);
    return `hello, ${name}!`;
  },
  [Symbol.asyncDispose]: async () => {
    logger.log("greeter disposed");
  },
});

const container = createContainer()
  .service("logger", createLogger)
  .service("db", ["logger"], createDb)
  .service("greeter", ["logger", "db"], createGreeter);

const main = async () => {
  await using app = await container.build();
  const message = await app.greeter.say(1);
  assert.equal(message, "hello, user-1!");
  console.log(message);
};

await main();
