import type { PositionalFactory } from "./class.js";

export function asFunctionArgs<Args extends readonly unknown[], Result>(
  fn: (...args: Args) => Result,
): PositionalFactory<Args, Result> {
  /* eslint-disable @typescript-eslint/consistent-type-assertions -- the brand exists only at the type level; positional args are aligned by the caller's deps declaration. */
  const factory = (deps: Record<string, unknown>): Result =>
    fn(...(Object.values(deps) as unknown as Args));
  return factory as PositionalFactory<Args, Result>;
  /* eslint-enable @typescript-eslint/consistent-type-assertions */
}
