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

type Clock = { now: () => Date };

const createClock = (): Clock => ({ now: () => new Date() });

type UserRepository = {
  find: (id: number) => Promise<User | undefined>;
};

const createUserRepository = ({ db }: { db: Db }): UserRepository => ({
  find: (id) => db.findUser(id),
});

const productionRegistry = createRegistry()
  .service("logger", createLogger)
  .service("db", ["logger"], createDb)
  .service("clock", createClock)
  .service("userRepository", ["db"], createUserRepository);

// Depends on `clock`, not `logger` — a different dependency than the original
// `db` registration used, and one registered *after* `db` in the chain above.
// `replaceService` isn't limited to the original deps or their position.
// The return type also widens: `seed`/`clear`/`createdAt` become callable on
// the resolved service.
const createStubDb = ({ clock }: { clock: Clock }) => {
  const users = new Map<number, User>();
  const createdAt = clock.now();
  return {
    findUser: async (id: number) => users.get(id),
    seed: (user: User) => users.set(user.id, user),
    clear: () => users.clear(),
    createdAt,
    [Symbol.asyncDispose]: async () => {
      console.log(
        `[test] stub db disposed (created ${createdAt.toISOString()})`,
      );
    },
  };
};

const testLogger: Logger = {
  log: (message) => console.log(`[test] ${message}`),
};

const testRegistry = productionRegistry
  .replaceService("db", ["clock"], createStubDb)
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
