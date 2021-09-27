'use strict'

class AbortError extends Error {
  public code = 'FETCH_ABORTED';
  public type = 'aborted'
  constructor (message: any = 'Aborted.') {
    super(message)
    Error.captureStackTrace(this, this.constructor)
  }

  get name () {
    return 'AbortError'
  }

  // don't allow name to be overridden, but don't throw either
  set name (s) {}
}
export default AbortError;