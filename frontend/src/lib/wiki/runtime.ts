export const yieldToUi = (): Promise<void> => {
  return new Promise((r) => setTimeout(r, 0));
};

export const sleep = async (ms: number): Promise<void> => {
  return new Promise<void>((r) => setTimeout(r, ms));
};

