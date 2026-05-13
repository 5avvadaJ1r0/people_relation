export const devLog = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.log(...args);
};
