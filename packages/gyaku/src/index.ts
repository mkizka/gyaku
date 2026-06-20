// `asClass` is not deprecated; only its positional `{ positional: true }`
// overload is. But @typescript-eslint/no-deprecated reads the JSDoc tags of all
// overloads combined when it sees a non-call reference like this re-export, so it
// flags the symbol here. Call sites that pass `{ positional: true }` still warn.
// eslint-disable-next-line @typescript-eslint/no-deprecated -- see note above.
export { asClass, asClassArgs } from "./class.js";
export {
  DisposeError,
  GyakuError,
  RegistryError,
  ResolveError,
  ServiceDisposeError,
  ServiceFactoryError,
} from "./errors.js";
export { createRegistry } from "./registry.js";
