function makeClassFactory(
  Ctor: new (...args: never[]) => unknown,
  options?: { positional?: boolean },
): (deps: Record<string, unknown>) => unknown {
  return (deps) => {
    const args = options?.positional ? Object.values(deps) : [deps];
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- `args` is aligned with the constructor parameters by the caller's deps declaration.
    return new Ctor(...(args as never[]));
  };
}

type ClassFactory<Instance> = {
  <Deps extends object>(
    Ctor: new (deps: Deps) => Instance,
  ): (deps: Deps) => Instance;
  (
    Ctor: new (...args: never[]) => Instance,
    options: { positional: true },
  ): (deps: Record<string, unknown>) => Instance;
};

export function asClass<Deps extends object, Instance>(
  Ctor: new (deps: Deps) => Instance,
): (deps: Deps) => Instance;

export function asClass<Instance>(
  Ctor: new (...args: never[]) => Instance,
  options: { positional: true },
): (deps: Record<string, unknown>) => Instance;

export function asClass<Instance>(): ClassFactory<Instance>;

export function asClass(
  Ctor?: new (...args: never[]) => unknown,
  options?: { positional?: boolean },
): unknown {
  if (Ctor === undefined) {
    return makeClassFactory;
  }
  return makeClassFactory(Ctor, options);
}
