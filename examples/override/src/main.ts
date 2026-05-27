import assert from "node:assert/strict";

import { createRegistry } from "@gyaku/di";

type Logger = { log: (message: string) => void };

const createLogger = (): Logger => ({
  log: (message) => console.log(`[log] ${message}`),
});

type User = { id: number; name: string };

type Db = {
  findUser: (id: number) => Promise<User | undefined>;
  [Symbol.asyncDispose]: () => Promise<void>;
};

const createDb = async ({ logger }: { logger: Logger }): Promise<Db> => {
  await new Promise((resolve) => setTimeout(resolve, 10));
  logger.log("db connected");
  return {
    findUser: async () => {
      throw new Error("real db should not be queried in this example");
    },
    [Symbol.asyncDispose]: async () => {
      logger.log("db disconnected");
    },
  };
};

type UserRepository = {
  find: (id: number) => Promise<User | undefined>;
};

const createUserRepository = ({ db }: { db: Db }): UserRepository => ({
  find: (id) => db.findUser(id),
});

const productionRegistry = createRegistry()
  .service("logger", createLogger)
  .service("db", ["logger"], createDb)
  .service("userRepository", ["db"], createUserRepository);

const testRegistry = productionRegistry.override("db", ({ logger }): Db => {
  const users = new Map<number, User>([[1, { id: 1, name: "stub-alice" }]]);
  logger.log("stub db ready");
  return {
    findUser: async (id) => users.get(id),
    [Symbol.asyncDispose]: async () => {
      logger.log("stub db disposed");
    },
  };
});

const main = async () => {
  await using app = await testRegistry.resolve();

  const alice = await app.userRepository.find(1);
  assert.deepEqual(alice, { id: 1, name: "stub-alice" });

  const missing = await app.userRepository.find(2);
  assert.equal(missing, undefined);

  console.log("override verified");
};

await main();
