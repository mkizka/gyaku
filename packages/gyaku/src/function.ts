import type { PositionalFactory } from "./class.js";

export function asFunctionArgs<Args extends readonly unknown[], Result>(
  fn: (...args: Args) => Result,
): PositionalFactory<Args, Result> {
  const factory = (deps: Record<string, unknown>): Result =>
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- positional args are aligned by the caller's deps declaration.
    fn(...(Object.values(deps) as unknown as Args));
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the brand exists only at the type level.
  return factory as PositionalFactory<Args, Result>;
}
