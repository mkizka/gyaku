import assert from "node:assert/strict";

import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { createRegistry } from "@gyaku/di";

type Config = { port: number };

type Logger = {
  info: (message: string) => void;
};

const createLogger = (): Logger => ({
  info: (message) => console.log(`[info] ${message}`),
});

type User = { id: number; name: string };

type Db = {
  findUser: (id: number) => Promise<User | undefined>;
  [Symbol.asyncDispose]: () => Promise<void>;
};

const createDb = async ({ logger }: { logger: Logger }): Promise<Db> => {
  await new Promise((resolve) => setTimeout(resolve, 10));
  logger.info("db connected");
  const users = new Map<number, User>([
    [1, { id: 1, name: "alice" }],
    [2, { id: 2, name: "bob" }],
  ]);
  return {
    findUser: async (id) => users.get(id),
    [Symbol.asyncDispose]: async () => {
      logger.info("db disconnected");
    },
  };
};

type UserRepository = {
  find: (id: number) => Promise<User | undefined>;
};

const createUserRepository = ({ db }: { db: Db }): UserRepository => ({
  find: (id) => db.findUser(id),
});

const createApp = ({
  logger,
  userRepository,
}: {
  logger: Logger;
  userRepository: UserRepository;
}) => {
  const app = new Hono();
  app.get("/users/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const user = await userRepository.find(id);
    if (!user) {
      logger.info(`user ${id} not found`);
      return c.json({ error: "not found" }, 404);
    }
    return c.json(user);
  });
  return app;
};

type Server = {
  url: string;
  [Symbol.asyncDispose]: () => Promise<void>;
};

const createServer = async ({
  app,
  config,
  logger,
}: {
  app: Hono;
  config: Config;
  logger: Logger;
}): Promise<Server> => {
  const server = await new Promise<ServerType>((resolve) => {
    const instance = serve({ fetch: app.fetch, port: config.port }, () =>
      resolve(instance),
    );
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null
      ? address.port
      : config.port;
  const url = `http://localhost:${port}`;
  logger.info(`listening on ${url}`);
  return {
    url,
    [Symbol.asyncDispose]: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      logger.info("server closed");
    },
  };
};

const registry = createRegistry()
  .value("config", { port: Number(process.env.PORT ?? 0) } satisfies Config)
  .service("logger", createLogger)
  .service("db", ["logger"], createDb)
  .service("userRepository", ["db"], createUserRepository)
  .service("app", ["logger", "userRepository"], createApp)
  .service("server", ["app", "config", "logger"], createServer);

const main = async () => {
  await using app = await registry.resolve();

  const ok = await fetch(`${app.server.url}/users/1`);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { id: 1, name: "alice" });

  const notFound = await fetch(`${app.server.url}/users/999`);
  assert.equal(notFound.status, 404);
  assert.deepEqual(await notFound.json(), { error: "not found" });

  console.log("requests verified");
};

await main();
