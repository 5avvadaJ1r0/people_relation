import dayjs from "dayjs";

export const formatExecutedAsMasterAt = (
  iso: string | null | undefined,
): string | null => {
  if (iso == null || iso === "") return null;
  const executedAt = dayjs(iso);
  if (!executedAt.isValid()) return null;
  return executedAt.format("YYYY年M月D日 H時m分");
};
