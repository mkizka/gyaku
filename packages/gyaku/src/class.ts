const POSITIONAL_FACTORY_BRAND: unique symbol = Symbol();

export type PositionalFactory<Args extends readonly unknown[], Instance> = ((
  deps: Record<string, unknown>,
) => Instance) & {
  // Each element is wrapped in `(arg: T) => void` to make Args contravariant,
  // so a factory accepting a wider type is assignable to one expecting a narrower
  // type (e.g. `(arg: LogLevel) => void` satisfies `(arg: "error") => void`).
  // Tuple length mismatch is still caught because tuples of different lengths
  // are never mutually assignable.
  readonly [POSITIONAL_FACTORY_BRAND]: readonly [
    ...{ [K in keyof Args]: (arg: Args[K]) => void },
  ];
};

export type NotPositionalFactory<T> = T & {
  readonly [POSITIONAL_FACTORY_BRAND]?: never;
};

function makeClassFactoryWithObject(
  Ctor: new (...args: never[]) => unknown,
): (deps?: Record<string, unknown>) => unknown {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the caller's deps declaration aligns with the constructor parameter.
  return (deps) => new Ctor(deps as never);
}

function makeClassFactoryWithArgs(
  Ctor: new (...args: never[]) => unknown,
): (deps?: Record<string, unknown>) => unknown {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- `args` is aligned with the constructor parameters by the caller's deps declaration.
  return (deps) => new Ctor(...(Object.values(deps ?? {}) as never[]));
}

type ClassFactory<Instance> = <Deps extends object>(
  Ctor: new (deps: Deps) => Instance,
) => (deps: Deps) => Instance;

export function asClass<Deps extends object, Instance>(
  Ctor: new (deps: Deps) => Instance,
): (deps: Deps) => Instance;

export function asClass<Instance>(): ClassFactory<Instance>;

export function asClass(Ctor?: new (...args: never[]) => unknown): unknown {
  if (Ctor === undefined) {
    return makeClassFactoryWithObject;
  }
  return makeClassFactoryWithObject(Ctor);
}

type ClassArgsFactory<Instance> = <Args extends readonly unknown[]>(
  Ctor: new (...args: Args) => Instance,
) => PositionalFactory<Args, Instance>;

export function asClassArgs<Args extends readonly unknown[], Instance>(
  Ctor: new (...args: Args) => Instance,
): PositionalFactory<Args, Instance>;

export function asClassArgs<Instance>(): ClassArgsFactory<Instance>;

export function asClassArgs(Ctor?: new (...args: never[]) => unknown): unknown {
  if (Ctor === undefined) {
    return makeClassFactoryWithArgs;
  }
  return makeClassFactoryWithArgs(Ctor);
}
