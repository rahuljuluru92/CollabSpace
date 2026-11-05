let shuttingDown = false;

/** Process-wide state used for graceful shutdown. */
export const lifecycle = {
  isShuttingDown: () => shuttingDown,
  beginShutdown: () => {
    shuttingDown = true;
  },
  /** Test helper. */
  reset: () => {
    shuttingDown = false;
  }
};
