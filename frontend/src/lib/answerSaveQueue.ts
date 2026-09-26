/** Serializes writes per question and provides a barrier before navigation or submission. */
export class AnswerSaveQueue {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly failures = new Map<string, unknown>();

  get failedQuestionIds(): string[] {
    return [...this.failures.keys()];
  }

  enqueue(questionId: string, save: () => Promise<void>): Promise<void> {
    const previous = this.pending.get(questionId);
    const operation = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(save);
    let tracked: Promise<void>;
    tracked = operation.then(
      () => { this.failures.delete(questionId); },
      (failure) => {
        this.failures.set(questionId, failure);
        throw failure;
      },
    ).finally(() => {
      if (this.pending.get(questionId) === tracked) this.pending.delete(questionId);
    });
    this.pending.set(questionId, tracked);
    return tracked;
  }

  async flush(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending.values()]);
    }
    if (this.failures.size > 0) {
      throw new Error(`Could not save ${this.failures.size} answer${this.failures.size === 1 ? "" : "s"}. Retry before continuing.`);
    }
  }
}
