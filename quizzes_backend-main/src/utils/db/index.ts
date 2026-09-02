import mongoose, { ClientSession } from "mongoose";

type TransactionCallback<T> = (session: ClientSession) => Promise<T>;

const MAX_TRANSACTION_RETRIES = 5;

const isTransientTransactionError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;

  const maybeError = error as {
    message?: string;
    errorLabels?: string[];
    code?: number;
  };

  const labels = maybeError.errorLabels || [];
  const message = maybeError.message || "";

  return (
    labels.includes("TransientTransactionError") ||
    labels.includes("UnknownTransactionCommitResult") ||
    maybeError.code === 112 ||
    message.includes("Write conflict")
  );
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executes a block of code within a MongoDB transaction.
 * @param callback The function containing the transactional logic
 */
export const runInTransaction = async <T>(
  callback: TransactionCallback<T>,
): Promise<T> => {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < MAX_TRANSACTION_RETRIES) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const result = await callback(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      lastError = error;
      try {
        await session.abortTransaction();
      } catch {
        // Ignore abort errors and prioritize the original failure.
      }

      attempt += 1;
      const canRetry = isTransientTransactionError(error);
      if (!canRetry || attempt >= MAX_TRANSACTION_RETRIES) {
        throw error;
      }

      // Incremental backoff reduces immediate contention on hot documents.
      await delay(75 * attempt);
    } finally {
      session.endSession();
    }
  }

  throw lastError;
};
