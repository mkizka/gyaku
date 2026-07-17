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

// Returns more than `Db`: `replaceService` widens the service type, so the
// extra `seed`/`clear` are callable on the resolved service.
const createStubDb = () => {
  const users = new Map<number, User>();
  return {
    findUser: async (id: number) => users.get(id),
    seed: (user: User) => users.set(user.id, user),
    clear: () => users.clear(),
    [Symbol.asyncDispose]: async () => {},
  };
};

const testLogger: Logger = {
  log: (message) => console.log(`[test] ${message}`),
};

const testRegistry = productionRegistry
  .replaceService("db", createStubDb)
  .replaceValue("logger", testLogger);

const main = async () => {
  await using app = await testRegistry.resolve();

  app.db.seed({ id: 1, name: "stub-alice" });

  const alice = await app.userRepository.find(1);
  assert.deepEqual(alice, { id: 1, name: "stub-alice" });

  const missing = await app.userRepository.find(2);
  assert.equal(missing, undefined);

  app.db.clear();
  assert.equal(await app.userRepository.find(1), undefined);

  console.log("replace verified");
};

await main();
