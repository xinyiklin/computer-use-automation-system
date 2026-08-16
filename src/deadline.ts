import { AutomationError } from "./errors.js";

export function remainingDeadlineMs(
  deadlineMs: number,
  stepId?: string,
): number {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) {
    throw new AutomationError(
      "RUN_DEADLINE_EXCEEDED",
      "Automation exceeded its configured wall-clock bound",
      "hard_failure",
      stepId === undefined ? {} : { stepId },
    );
  }
  return remaining;
}

export async function withinDeadline<T>(
  deadlineMs: number,
  stepId: string | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
  cancel?: () => Promise<void>,
): Promise<T> {
  const remaining = remainingDeadlineMs(deadlineMs, stepId);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadlineError = new AutomationError(
    "RUN_DEADLINE_EXCEEDED",
    "Automation exceeded its configured wall-clock bound",
    "hard_failure",
    stepId === undefined ? {} : { stepId },
  );
  const activeOperation = Promise.resolve().then(() =>
    operation(controller.signal),
  );
  try {
    return await Promise.race([
      activeOperation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(deadlineError), remaining);
      }),
    ]);
  } catch (error) {
    if (error === deadlineError) {
      controller.abort(deadlineError);
      if (cancel) {
        void Promise.resolve()
          .then(cancel)
          .catch(() => undefined);
      }
      void activeOperation.catch(() => undefined);
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function settleWithinDeadline(
  deadlineMs: number,
  operation: () => Promise<void>,
): Promise<void> {
  const activeOperation = Promise.resolve()
    .then(operation)
    .catch(() => undefined);
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) {
    void activeOperation;
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    activeOperation,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, remaining);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
}
