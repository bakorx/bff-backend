/**
 * Standard HTTP status codes used across the API.
 *
 * Lives in its own module to break the circular import between
 * `./middlewares` and `./index`. `index.ts` re-exports middlewares, so
 * middlewares cannot import from `./index` without picking up a partial
 * exports object — destructured symbols like `STATUS_CODES` come back
 * `undefined` at runtime when something tries to read them at module load.
 */
export const STATUS_CODES = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
};
