import { AudioData, byteSize } from './buffer';

export interface Snapshot<M = unknown> {
  audio: AudioData;
  label: string;
  meta?: M;
}

/**
 * Undo/redo stack of immutable snapshots with a memory budget.
 * Because edits are pure, snapshots share no mutable state.
 */
export class History<M = unknown> {
  private undoStack: Snapshot<M>[] = [];
  private redoStack: Snapshot<M>[] = [];
  constructor(private maxBytes = 512 * 1024 * 1024, private maxSteps = 100) {}

  push(prev: Snapshot<M>) {
    this.undoStack.push(prev);
    this.redoStack = [];
    this.trim();
  }

  undo(current: Snapshot<M>): Snapshot<M> | null {
    const s = this.undoStack.pop();
    if (!s) return null;
    this.redoStack.push(current);
    return s;
  }

  redo(current: Snapshot<M>): Snapshot<M> | null {
    const s = this.redoStack.pop();
    if (!s) return null;
    this.undoStack.push(current);
    return s;
  }

  /** Labels of the actions that can be undone, oldest first. */
  get undoLabels() { return this.undoStack.map((s) => s.label); }
  /** Labels of the actions that can be redone, next first. */
  get redoLabels() { return [...this.redoStack].reverse().map((s) => s.label); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get undoLabel() { return this.undoStack[this.undoStack.length - 1]?.label; }
  get redoLabel() { return this.redoStack[this.redoStack.length - 1]?.label; }
  get size() { return this.undoStack.length; }

  private trim() {
    while (this.undoStack.length > this.maxSteps) this.undoStack.shift();
    let total = this.undoStack.reduce((s, x) => s + byteSize(x.audio), 0);
    while (total > this.maxBytes && this.undoStack.length > 1) {
      total -= byteSize(this.undoStack.shift()!.audio);
    }
  }
}
